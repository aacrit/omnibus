// scripts/verify-shard-collection.mjs (CI0, ci0/speed): proves the 4 studio-full shards'
// collected test ids, taken together, equal the full `studio/tests` collection with no
// gaps and no duplicates.
import { describe, expect, it } from "vitest";
import { extractNodeIds, verifyShardCollection } from "../scripts/verify-shard-collection.mjs";

describe("extractNodeIds", () => {
  it("keeps only lines that look like a pytest node id", () => {
    const output = [
      "studio/tests/test_a.py::test_one",
      "studio/tests/test_a.py::test_two[param-1]",
      "",
      "============================== warnings summary ===============================",
      "studio/tests/test_a.py:12",
      "  a SyntaxWarning, not a node id",
      "",
      "3034 tests collected in 4.23s",
    ].join("\n");
    expect(extractNodeIds(output)).toEqual([
      "studio/tests/test_a.py::test_one",
      "studio/tests/test_a.py::test_two[param-1]",
    ]);
  });
});

describe("verifyShardCollection", () => {
  const full = ["a::1", "a::2", "b::1", "b::2"];

  it("passes when every full id appears in exactly one shard", () => {
    const shards = [["a::1", "a::2"], ["b::1", "b::2"]];
    expect(verifyShardCollection(full, shards)).toEqual([]);
  });

  it("passes with more than 2 shards, uneven groups", () => {
    const shards = [["a::1"], ["a::2"], ["b::1"], ["b::2"]];
    expect(verifyShardCollection(full, shards)).toEqual([]);
  });

  it("catches a gap: a full id that no shard collected", () => {
    const shards = [["a::1", "a::2"], ["b::1"]];
    const violations = verifyShardCollection(full, shards);
    expect(violations.some((v) => v.includes("b::2") && v.includes("run by no shard"))).toBe(true);
  });

  it("catches a duplicate: the same id collected by two shards", () => {
    const shards = [["a::1", "a::2", "b::1"], ["b::1", "b::2"]];
    const violations = verifyShardCollection(full, shards);
    expect(violations.some((v) => v.includes("b::1") && v.includes("more than one shard"))).toBe(true);
  });

  it("catches a duplicate within a single shard", () => {
    const shards = [["a::1", "a::1", "a::2"], ["b::1", "b::2"]];
    const violations = verifyShardCollection(full, shards);
    expect(violations.some((v) => v.includes("twice within the same shard"))).toBe(true);
  });

  it("catches an extra id a shard ran that is not in the full collection", () => {
    const shards = [["a::1", "a::2", "ghost::1"], ["b::1", "b::2"]];
    const violations = verifyShardCollection(full, shards);
    expect(violations.some((v) => v.includes("ghost::1") && v.includes("not in the full collection"))).toBe(true);
  });
});
