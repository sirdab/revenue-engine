import multer from "multer";
import { MAX_FILE_SIZE_BYTES } from "./file-validation";

// Multer config for the /files upload route, kept here (dependency-free — no
// @workspace/db) so the encoding-sensitive part is characterization-testable
// under `node --test`, same rationale as file-validation.ts. routes/files.ts
// can't be imported by a test because it pulls in the DB layer.
//
// defParamCharset is the load-bearing setting: a browser posting FormData puts
// the raw UTF-8 bytes of a non-ASCII filename in the plain Content-Disposition
// `filename=` param (it does NOT send the RFC 5987 `filename*` form). Multer
// defaults that param's charset to latin1, so an Arabic filename decodes to
// mojibake (Ø´Ø±ÙØ©…) in req.file.originalname and that garbage is what gets
// stored in crm_files.file_name and rendered in the Documents card. Decoding
// as UTF-8 fixes it. `filename*` forms are unaffected — busboy decodes those
// by their own embedded charset regardless of this setting.
export const fileUploadMulterOptions: multer.Options = {
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  defParamCharset: "utf8",
};

export const fileUpload = multer(fileUploadMulterOptions);
