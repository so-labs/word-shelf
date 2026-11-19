import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  SHARE_CACHE_NAME,
  SHARE_FILE_NAME_HEADER,
  decodeSharedFileName,
  resolveSharedFileUrl,
} from "../src/core/shared-file";

function readPublic(name: string): string {
  return readFileSync(new URL(`../public/${name}`, import.meta.url), "utf-8");
}

describe("共有メニュー（Web Share Target）の受け取り", () => {
  it("ファイル名をデコードし、取れない場合は正本の名前に倒す", () => {
    assert.equal(decodeSharedFileName(encodeURIComponent("正本.tsv")), "正本.tsv");
    assert.equal(decodeSharedFileName("DictionaryMaster.tsv"), "DictionaryMaster.tsv");
    assert.equal(decodeSharedFileName(null), "DictionaryMaster.tsv");
    assert.equal(decodeSharedFileName(""), "DictionaryMaster.tsv");
    assert.equal(decodeSharedFileName("%E0%A4%A"), "DictionaryMaster.tsv");
  });

  it("共有ファイルのURLは基底URL配下の shared-file になる", () => {
    assert.equal(
      resolveSharedFileUrl("https://example.com/word-shelf/"),
      "https://example.com/word-shelf/shared-file",
    );
  });

  it("manifestにshare_targetがPOSTのmultipartで定義されている", () => {
    const manifest = JSON.parse(readPublic("manifest.webmanifest")) as {
      share_target?: {
        action: string;
        method: string;
        enctype: string;
        params: { files: { name: string; accept: string[] }[] };
      };
    };
    assert.ok(manifest.share_target);
    assert.equal(manifest.share_target.action, "./share-target");
    assert.equal(manifest.share_target.method, "POST");
    assert.equal(manifest.share_target.enctype, "multipart/form-data");
    assert.equal(manifest.share_target.params.files.length, 1);
    // sw.jsが取り出すフォームの名前と揃っていること
    assert.equal(manifest.share_target.params.files[0]?.name, "file");
    assert.ok(manifest.share_target.params.files[0]?.accept.includes(".tsv"));
  });

  it("sw.jsの共有受け取りがアプリ側の定数と揃っている", () => {
    const sw = readPublic("sw.js");
    assert.ok(sw.includes(`"${SHARE_CACHE_NAME}"`));
    assert.ok(sw.includes('endsWith("/share-target")'));
    assert.ok(sw.includes("formData()"));
    assert.ok(sw.includes(SHARE_FILE_NAME_HEADER));
    assert.ok(sw.includes("?shared=1"));
  });
});
