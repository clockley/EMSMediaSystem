// A local, video-only transport. The sender borrows capture tracks; closing a
// relay must never stop the stream still used by the confidence monitor.
export class LocalVideoRelay {
  constructor({ sendSignal, onStream = () => {}, onClose = () => {}, Peer = globalThis.RTCPeerConnection,
    Stream = globalThis.MediaStream }) {
    this.sendSignal = sendSignal;
    this.onClose = onClose;
    this.closed = false;
    this.candidates = [];
    this.operations = Promise.resolve();
    this.peer = new Peer({ iceServers: [] });
    this.stream = new Stream();
    this.peer.onicecandidate = ({ candidate }) => {
      if (!this.closed && candidate) this.sendSignal({ type: "candidate", candidate: candidate.toJSON() });
    };
    this.peer.ontrack = ({ track }) => {
      if (this.closed || track.kind !== "video") return;
      this.stream.addTrack(track);
      onStream(this.stream);
    };
    this.peer.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(this.peer.connectionState)) this.close();
    };
  }

  enqueue(operation) {
    this.operations = this.operations.then(async () => {
      if (!this.closed) await operation();
    }).catch(() => this.close());
    return this.operations;
  }

  start(stream) {
    return this.enqueue(async () => {
      for (const track of stream.getVideoTracks()) this.peer.addTrack(track, stream);
      const offer = await this.peer.createOffer();
      if (this.closed) return;
      await this.peer.setLocalDescription(offer);
      if (!this.closed) this.sendSignal({ type: "description", description: this.peer.localDescription.toJSON() });
    });
  }

  receive(message) {
    // Close is cancellation, not negotiation: it must not wait behind a
    // pending offer/answer operation that it is meant to cancel.
    if (message.type === "close") {
      this.close(false);
      return Promise.resolve();
    }
    return this.enqueue(async () => {
      if (message.type === "candidate") {
        if (this.peer.remoteDescription) await this.peer.addIceCandidate(message.candidate);
        else this.candidates.push(message.candidate);
        return;
      }
      if (message.type !== "description") return;
      await this.peer.setRemoteDescription(message.description);
      if (this.closed) return;
      for (const candidate of this.candidates.splice(0)) {
        if (this.closed) return;
        await this.peer.addIceCandidate(candidate);
      }
      if (message.description.type === "offer") {
        const answer = await this.peer.createAnswer();
        if (this.closed) return;
        await this.peer.setLocalDescription(answer);
        if (!this.closed) this.sendSignal({ type: "description", description: this.peer.localDescription.toJSON() });
      }
    });
  }

  close(notify = true) {
    if (this.closed) return;
    this.closed = true;
    this.peer.onicecandidate = this.peer.ontrack = this.peer.onconnectionstatechange = null;
    this.peer.close();
    // These are receiver-owned tracks only; borrowed sender tracks were
    // passed directly to addTrack and are deliberately not stopped here.
    for (const track of this.stream.getTracks?.() || []) track.stop();
    this.candidates.length = 0;
    if (notify) this.sendSignal({ type: "close" });
    this.onClose();
  }
}