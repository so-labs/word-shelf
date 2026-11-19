import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseExportTargets } from "../src/core/export-targets";

describe("出力対象の控えの読み解き", () => {
  it("控えがなければ両方ONが既定になる", () => {
    assert.deepEqual(parseExportTargets(null), { google: true, microsoft: true });
  });

  it("保存した選択をそのまま復元する", () => {
    assert.deepEqual(parseExportTargets('{"google":false,"microsoft":true}'), {
      google: false,
      microsoft: true,
    });
    assert.deepEqual(parseExportTargets('{"google":false,"microsoft":false}'), {
      google: false,
      microsoft: false,
    });
  });

  it("壊れた値や型の違う項目は既定（ON）へ倒す", () => {
    assert.deepEqual(parseExportTargets("not json"), { google: true, microsoft: true });
    assert.deepEqual(parseExportTargets('{"google":"yes"}'), {
      google: true,
      microsoft: true,
    });
    assert.deepEqual(parseExportTargets('{"microsoft":false}'), {
      google: true,
      microsoft: false,
    });
  });
});
