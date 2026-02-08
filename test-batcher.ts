import { DataBatcher } from "./claxedo/src/server/lib/data-batcher.ts";

console.log("Starting Batcher Test");

const batcher = new DataBatcher((data) => {
  console.log("FLUSHED:", JSON.stringify(data));
});

console.log("Writing string 'hello'");
batcher.write("hello");

console.log("Writing buffer ' world' (as buffer)");
batcher.write(Buffer.from(" world"));

console.log("Writing immediate flush via large chunk (simulated)");
batcher.flush();

console.log("Writing partial unicode (should buffer)");
const euro = Buffer.from("€"); // 3 bytes: e2 82 ac
batcher.write(euro.subarray(0, 1)); // e2
batcher.write(euro.subarray(1, 2)); // 82
console.log("Should not have flushed euro yet...");
batcher.write(euro.subarray(2, 3)); // ac
batcher.flush();

console.log("Done");
