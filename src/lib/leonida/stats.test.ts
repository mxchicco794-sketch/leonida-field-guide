import { describe, expect, it } from "vitest";
import { groupProgress } from "./stats";
import type { Kind, LeonidaLocation } from "./types";

const kinds: Kind[] = [
  { key: "card", name: "Cards", colour: "#fff", icon: "", group: "Collectibles" },
  { key: "shop", name: "Shops", colour: "#fff", icon: "", group: "Places" },
];
const loc = (id: string, kind: string): LeonidaLocation => ({ id, kind, x: 0, y: 0, name: id });

describe("groupProgress", () => {
  it("counts found items only within the group", () => {
    const r = groupProgress([loc("a", "card"), loc("b", "card"), loc("c", "shop")], kinds, "Collectibles", ["a", "c"]);
    expect(r).toHaveLength(1);
    expect(r[0]?.total).toBe(2);
    expect(r[0]?.found).toBe(1);
  });
});
