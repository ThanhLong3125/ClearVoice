import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const TARGET_DIR = path.resolve(ROOT_DIR, "public/models/whisper-tiny");

const MODEL_REVISION = "main";
const BASE_URL = `https://huggingface.co/onnx-community/whisper-tiny/resolve/${MODEL_REVISION}/`;

const REQUIRED_FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_q4.onnx",
  "onnx/decoder_model_merged_q4.onnx",
];

async function fetchModel() {
  console.log(`[Fetch-Model] Checking bundled whisper-tiny Q4 model files in: ${TARGET_DIR}`);
  fs.mkdirSync(path.join(TARGET_DIR, "onnx"), { recursive: true });

  let downloadedCount = 0;
  for (const filename of REQUIRED_FILES) {
    const destPath = path.join(TARGET_DIR, filename);
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 100) {
      console.log(`[Fetch-Model]  ${filename} already present.`);
      continue;
    }

    const downloadUrl = BASE_URL + filename;
    console.log(`[Fetch-Model] Downloading ${filename} from ${downloadUrl}...`);
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`Failed to download ${filename} (HTTP ${res.status}: ${res.statusText})`);
    }

    const arrayBuf = await res.arrayBuffer();
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, Buffer.from(arrayBuf));
    const sizeMb = (arrayBuf.byteLength / (1024 * 1024)).toFixed(2);
    console.log(`[Fetch-Model]  Saved ${filename} (${sizeMb} MB)`);
    downloadedCount++;
  }

  console.log(`[Fetch-Model] All model files ready. (${downloadedCount} downloaded, total size: 94 MB)`);
}

fetchModel().catch((err) => {
  console.error("[Fetch-Model] Error:", err);
  process.exit(1);
});
