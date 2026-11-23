import assert from "node:assert/strict";
import { indiaMusicEngine } from "./india-music-engine.js";

const originalFetch = globalThis.fetch;
try {
  let calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url); calls.push(u);
    if (u.includes("saavn.dev")) return new Response(JSON.stringify({ data: { results: [{
      id: "song-1", name: "Test Hindi Song", primaryArtists: "Test Artist", duration: 210,
      image: [{url:"https://img.example/1.jpg"}],
      downloadUrl: [{quality:"160kbps",url:"https://cdn.example/low.mp3"},{quality:"320kbps",url:"https://cdn.example/high.mp3"}]
    }] } }), {status:200,headers:{"content-type":"application/json"}});
    throw new Error("Unexpected provider call: " + u);
  };
  const primary = await indiaMusicEngine.search("test hindi song", 20);
  assert.equal(primary.provider, "jiosaavn");
  assert.equal(primary.items.length, 1);
  assert.equal(primary.items[0].source, "online");
  assert.equal(primary.items[0].sourceProvider, "jiosaavn");
  assert.equal(primary.items[0].streamUrl, "https://cdn.example/high.mp3");
  assert.ok(primary.items[0].id.startsWith("online:jiosaavn:"));

  indiaMusicEngine.pipedInstances = [];
  indiaMusicEngine.audiusHost = null;
  calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url); calls.push(u);
    if (u.includes("saavn.dev")) return new Response(JSON.stringify({data:{results:[]}}),{status:200});
    if (u.includes("piped-instances")) return new Response(JSON.stringify([]),{status:200});
    if (u.includes("pipedapi.adminforge.de/search")) return new Response(JSON.stringify([]),{status:200});
    if (u === "https://api.audius.co") return new Response(JSON.stringify({data:[]}),{status:200});
    if (u.includes("/v1/tracks/search")) return new Response(JSON.stringify({data:[{
      id:"aud-1",title:"Audius Track",duration:180,user:{name:"Audius Artist"},
      artwork:{"480x480":"https://img.example/a.jpg"}
    }]}),{status:200});
    throw new Error("Unexpected fallback call: " + u);
  };
  const fallback = await indiaMusicEngine.search("audius track", 20);
  assert.equal(fallback.provider, "audius");
  assert.equal(fallback.items[0].sourceProvider, "audius");
  assert.ok(fallback.items[0].streamUrl.includes("/v1/tracks/aud-1/stream"));
  assert.ok(calls.some(x => x.includes("saavn.dev")));
  assert.ok(calls.some(x => x.includes("/search?q=")));
  console.log("PASS: JioSaavn normalization, highest-bitrate selection, and JioSaavn -> Piped -> Audius fallback");
} finally {
  globalThis.fetch = originalFetch;
}
