// Evaluate an expression in a CDP page target by title match.
// Usage: node tests/browser/cdp-eval.mjs "<title-substring>" "<expression>"
const [, , titleMatch, expression] = process.argv;
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const target = targets.find(
  (entry) => entry.type === "page" && entry.title.includes(titleMatch),
);
if (!target) {
  console.error("no target matching", titleMatch, "available:", targets.map((t) => t.title));
  process.exit(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("cdp timeout")), 15000);
  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
      }),
    );
  };
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id === 1) {
      clearTimeout(timer);
      resolve(message.result);
    }
  };
  ws.onerror = (event) => {
    clearTimeout(timer);
    reject(new Error(`ws error: ${event.message || "unknown"}`));
  };
});
console.log(JSON.stringify(result, null, 2));
ws.close();
