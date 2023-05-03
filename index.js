const targetPath = "./Animated_PNG_example_bouncing_beach_ball.png";

// https://www.w3.org/TR/png/#samplecrc
const crcTable = [];
for (let i = 0; i < 256; i++) {
  let currentCrc = i;
  for (let j = 0; j < 8; j++) {
    if (currentCrc & 1) {
      currentCrc = 0xedb88320 ^ (currentCrc >>> 1);
    } else {
      currentCrc = currentCrc >>> 1;
    }
  }
  crcTable[i] = currentCrc;
}

function crc32(buf) {
  // use typed array to handle overflow
  let crc = new Uint32Array([0xffffffff]);
  for (let i = 0; i < buf.length; i++) {
    crc[0] = crcTable[(crc[0] ^ buf[i]) & 0xff] ^ (crc[0] >>> 8);
  }
  crc[0] = crc[0] ^ 0xffffffff;
  return crc[0];
}

// create a chunk by chunk type and data bytes
function encodeChunk(chunkType, dataBytes) {
  const chunk = new Uint8Array(dataBytes.length + 12);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, dataBytes.length);
  chunk.set(new TextEncoder().encode(chunkType), 4);
  chunk.set(dataBytes, 8);
  // based on type field and data field
  const crc = crc32(chunk.slice(4, dataBytes.length + 8));
  dv.setUint32(dataBytes.length + 8, crc);
  return chunk;
}

function parseApng(bytes) {
  let offset = 0;
  const magic = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.slice(offset, offset + 8).every((v, i) => v === magic[i])) {
    throw new Error("magic number check fail");
  }
  offset += 8;

  const dv = new DataView(bytes.buffer);
  const otherChunks = [];
  const frames = [];
  let frame;
  let ihdrChunk;
  let acTLChunk;
  let IENDChunk;

  while (offset < bytes.length) {
    const chunkLength = dv.getUint32(offset) + 12;
    const chunkType = new TextDecoder().decode(
      bytes.slice(offset + 4, offset + 8)
    );
    const chunk = bytes.slice(offset, offset + chunkLength);

    switch (chunkType) {
      case "IHDR": {
        ihdrChunk = chunk;
        break;
      }
      case "acTL": {
        acTLChunk = chunk;
        break;
      }
      case "fcTL": {
        if (frame) frames.push(frame);

        frame = {
          fcTLChunk: chunk,
          dataBytes: [],
        };
        break;
      }
      case "IDAT": {
        if (frame) {
          // only data-bytes
          // 4(data-length) + 4(type) + data-bytes + 4(crc)
          frame.dataBytes.push(chunk.slice(8, chunkLength - 4));
        }
        break;
      }
      case "fdAT": {
        if (!frame) throw new Error("unexpected fdAT chunk");
        // same structure as IDAT chunk
        // but with an extra sequence field at first
        frame.dataBytes.push(chunk.slice(12, chunkLength - 4));
        break;
      }
      case "IEND": {
        IENDChunk = chunk;
        break;
      }
      default:
        otherChunks.push(chunk);
    }

    offset += chunkLength;
  }

  const apng = {};

  if (!ihdrChunk) {
    throw new Error("no ihdr chunk");
  }
  const ihdrChunkDv = new DataView(ihdrChunk.slice(8).buffer);
  apng.width = ihdrChunkDv.getUint32(0);
  apng.height = ihdrChunkDv.getUint32(4);

  if (!acTLChunk) {
    throw new Error("no acTL chunk");
  }
  const acTLChunkDv = new DataView(acTLChunk.slice(8).buffer);
  apng.numPlays = acTLChunkDv.getUint32(4);
  if (apng.numPlays === 0) {
    apng.numPlays = Infinity;
  }

  if (!IENDChunk) {
    throw new Error("no IEND chunk");
  }

  apng.frames = frames.map(({ dataBytes, fcTLChunk }) => {
    const chunks = [magic];
    // set frame width and height
    ihdrChunk.set(fcTLChunk.slice(0, 4), 0);
    ihdrChunk.set(fcTLChunk.slice(4, 8), 4);
    chunks.push(encodeChunk("IHDR", ihdrChunk.slice(8, ihdrChunk.length - 4)));

    chunks.push(...otherChunks);

    chunks.push(...dataBytes.map((dataPart) => encodeChunk("IDAT", dataPart)));

    chunks.push(IENDChunk);

    const image = new Blob(chunks, { type: "image/png" });

    // control info
    const dv = new DataView(fcTLChunk.slice(8).buffer);
    const sequenceNum = dv.getUint32(0);
    const width = dv.getUint32(4);
    const height = dv.getUint32(8);
    const xOffset = dv.getUint32(12);
    const yOffset = dv.getUint32(16);
    const delayNum = dv.getUint16(20);
    const delayDen = dv.getUint16(22);
    const disposeOp = dv.getUint8(24);
    const blendOp = dv.getUint8(25);

    return {
      image,
      sequenceNum,
      width,
      height,
      xOffset,
      yOffset,
      delay: (delayNum / (delayDen || 100)) * 1000,
      disposeOp,
      blendOp,
    };
  });

  return apng;
}

async function loadImg(targetPath) {
  const img = await fetch(targetPath);
  const arrayBuffer = await img.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

function play(apng) {
  const canvas = document.createElement("canvas");
  canvas.width = apng.width;
  canvas.height = apng.height;
  document.getElementById("container").appendChild(canvas);

  const ctx = canvas.getContext("2d");

  let frameIndex = 0;
  let numFramePlays = apng.numPlays * apng.frames.length;

  const draw = () => {
    const frame = apng.frames[frameIndex];
    frameIndex = frameIndex >= apng.frames.length - 1 ? 0 : frameIndex + 1;

    if (frame.disposeOp === 1) {
      ctx.clearRect(0, 0, apng.width, apng.height);
    }
    ctx.drawImage(
      frame.imageElement,
      frame.xOffset,
      frame.yOffset,
      frame.width,
      frame.height
    );

    if (--numFramePlays <= 0) return;

    setTimeout(draw, frame.delay);
  };

  draw();
}

function loadImgElement(frame) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(frame.image);
    const imageElement = document.createElement("img");
    imageElement.onload = () => {
      frame.imageElement = imageElement;
      resolve();
    };
    imageElement.src = url;
  });
}

async function main() {
  // 1. load APNG image
  const bytes = await loadImg(targetPath);

  // 2. parse the image
  const apng = parseApng(bytes);

  // 3. load it into html img element
  await Promise.all(apng.frames.map(loadImgElement));

  // 4. play it on canvas
  play(apng);
}

main();
