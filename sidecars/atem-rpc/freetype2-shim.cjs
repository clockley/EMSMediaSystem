// ATEM switching does not use atem-connection's optional multiview label
// renderer. Keeping this native dependency out makes the RPC bundle portable.
function unsupported() {
  throw new Error("Multiview label rendering is not available in the ATEM sidecar");
}

module.exports = new Proxy({}, { get: () => unsupported });

