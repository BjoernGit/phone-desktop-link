import { useEffect, useRef, useState, useCallback } from "react";

const MAX_ICE_CANDIDATES = 100; // Maximum buffered candidates per peer
const ICE_CANDIDATE_STATS = new Map(); // Track dropped candidates per peer for debugging

/**
 * WebRTC Hook for P2P file transfer
 * Manages RTCPeerConnection and DataChannel setup
 */
export function useWebRTC({ socket, clientUuid, enabled = true }) {
  const [connections, setConnections] = useState(new Map()); // peerUuid -> RTCPeerConnection
  const [dataChannels, setDataChannels] = useState(new Map()); // peerUuid -> RTCDataChannel
  const [connectionStates, setConnectionStates] = useState(new Map()); // peerUuid -> state
  const connectionsRef = useRef(new Map());
  const dataChannelsRef = useRef(new Map());
  const iceCandidateBufferRef = useRef(new Map()); // peerUuid -> candidate[]
  const abortControllersRef = useRef(new Map()); // peerUuid -> AbortController
  const messageBufferRef = useRef(new Map()); // peerUuid -> buffered messages (before listener attached)
  const messageCallbacksRef = useRef(new Map()); // peerUuid -> callback function

  // ICE servers configuration
  // Note: For production with real P2P between different networks,
  // you may need to add your own TURN server here.
  // For now, we rely on STUN for localhost and Socket.io fallback for reliability.
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
  ];

  // Create a new RTCPeerConnection for a peer
  const createConnection = useCallback(
    (peerUuid) => {
      if (!enabled || !socket) return null;

      const pc = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });

      // Handle ICE candidates - send to peer via signaling
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          // Send candidate immediately - receiver will buffer if needed
          // This is proper Trickle ICE behavior
          console.log(`[WebRTC] Sending ICE candidate to ${peerUuid}`);
          socket.emit("webrtc-ice-candidate", {
            targetUuid: peerUuid,
            candidate: event.candidate,
          });
        } else {
          // ICE gathering complete (event.candidate === null)
          console.log(`[WebRTC] ICE gathering complete for ${peerUuid}`);
        }
      };

      // Track ICE connection state for debugging
      pc.oniceconnectionstatechange = () => {
        console.log(`[WebRTC] ICE connection state for ${peerUuid}: ${pc.iceConnectionState}`);

        if (pc.iceConnectionState === "failed") {
          console.error(`[WebRTC] ICE connection failed for ${peerUuid}`);
        } else if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          console.log(`[WebRTC] ICE connection successful for ${peerUuid}`);
        }
      };

      // Track ICE gathering state
      pc.onicegatheringstatechange = () => {
        console.log(`[WebRTC] ICE gathering state for ${peerUuid}: ${pc.iceGatheringState}`);
      };

      // Track connection state
      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Connection state for ${peerUuid}: ${pc.connectionState}`);

        setConnectionStates((prev) => {
          const next = new Map(prev);
          next.set(peerUuid, pc.connectionState);
          return next;
        });

        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closeConnection(peerUuid);
        }
      };

      connectionsRef.current.set(peerUuid, pc);
      setConnections(new Map(connectionsRef.current));

      return pc;
    },
    [socket, enabled]
  );

  // Register a message callback for a peer's DataChannel
  // This immediately delivers any buffered messages and sets up forwarding for future messages
  const registerMessageCallback = useCallback((peerUuid, callback) => {
    console.log(`[WebRTC] Registering message callback for ${peerUuid}`);
    messageCallbacksRef.current.set(peerUuid, callback);

    // Deliver any buffered messages immediately
    const bufferedMessages = messageBufferRef.current.get(peerUuid) || [];
    if (bufferedMessages.length > 0) {
      console.log(`[WebRTC] Delivering ${bufferedMessages.length} buffered messages for ${peerUuid}`);
      bufferedMessages.forEach(msg => callback(msg));
      messageBufferRef.current.delete(peerUuid);
    }

    // Return cleanup function
    return () => {
      messageCallbacksRef.current.delete(peerUuid);
    };
  }, []);

  // Create offer (initiator side)
  // Returns a Promise that resolves when DataChannel is open, or null on timeout
  const createOffer = useCallback(
    async (peerUuid, timeoutMs = 15000) => {
      if (!enabled || !socket) return null;

      // Check if we already have an open DataChannel (e.g., from receiving an offer)
      const existingDc = dataChannelsRef.current.get(peerUuid);
      if (existingDc && existingDc.readyState === "open") {
        console.log(`[WebRTC] Already have open DataChannel for ${peerUuid}, skipping offer`);
        return existingDc;
      }

      console.log(`[WebRTC] Creating offer for ${peerUuid}`);

      let pc = connectionsRef.current.get(peerUuid);
      if (!pc) {
        pc = createConnection(peerUuid);
      }

      // Initialize ICE candidate buffer for this peer
      if (!iceCandidateBufferRef.current.has(peerUuid)) {
        iceCandidateBufferRef.current.set(peerUuid, []);
      }

      // Create data channel BEFORE creating offer
      const dc = pc.createDataChannel("fileTransfer", {
        ordered: true,
      });

      console.log(`[WebRTC] DataChannel created for ${peerUuid}, initial state: ${dc.readyState}`);

      // CRITICAL: Attach message listener IMMEDIATELY to avoid race condition
      // Messages may arrive before App.jsx's useEffect registers a callback
      dc.addEventListener("message", (msgEvent) => {
        const callback = messageCallbacksRef.current.get(peerUuid);
        if (callback) {
          // Callback is registered, forward message directly
          callback(msgEvent);
        } else {
          // No callback yet, buffer the message
          console.log(`[WebRTC] Buffering message for ${peerUuid} (no callback registered yet, initiator side)`);
          const buffer = messageBufferRef.current.get(peerUuid) || [];
          buffer.push(msgEvent);
          messageBufferRef.current.set(peerUuid, buffer);
        }
      });

      // Create a promise that resolves when the DataChannel opens
      const dataChannelReady = new Promise((resolve) => {
        let resolved = false;

        const timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.warn(`[WebRTC] DataChannel open timeout for ${peerUuid} after ${timeoutMs}ms`);
            resolve(null);
          }
        }, timeoutMs);

        dc.onopen = () => {
          console.log(`[WebRTC] DataChannel opened for ${peerUuid}`);
          dataChannelsRef.current.set(peerUuid, dc);
          setDataChannels(new Map(dataChannelsRef.current));

          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            resolve(dc);
          }
        };

        // If already open (unlikely but possible), resolve immediately
        if (dc.readyState === "open") {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            dataChannelsRef.current.set(peerUuid, dc);
            setDataChannels(new Map(dataChannelsRef.current));
            resolve(dc);
          }
        }
      });

      dc.onclose = () => {
        console.log(`[WebRTC] DataChannel closed for ${peerUuid}`);
        dataChannelsRef.current.delete(peerUuid);
        setDataChannels(new Map(dataChannelsRef.current));
        // Clean up message buffer and callback
        messageBufferRef.current.delete(peerUuid);
        messageCallbacksRef.current.delete(peerUuid);
      };

      dc.onerror = (error) => {
        console.error(`[WebRTC] DataChannel error for ${peerUuid}:`, error);
      };

      dc.onstatechange = () => {
        console.log(`[WebRTC] DataChannel state changed for ${peerUuid}: ${dc.readyState}`);
      };

      // Create and send offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

      console.log(`[WebRTC] Sending offer to ${peerUuid}`);
      socket.emit("webrtc-offer", {
        targetUuid: peerUuid,
        sdp: pc.localDescription,
      });

      // Return the promise - caller can await to get the open DataChannel
      return dataChannelReady;
    },
    [socket, enabled, createConnection]
  );

  // Handle incoming offer (receiver side)
  const handleOffer = useCallback(
    async (fromUuid, sdp) => {
      if (!enabled || !socket) return;

      // Create AbortController for this operation
      const abortController = new AbortController();
      abortControllersRef.current.set(fromUuid, abortController);

      try {
        // Check if aborted
        if (abortController.signal.aborted) {
          console.log(`[WebRTC] Offer handling aborted for ${fromUuid}`);
          return;
        }

        console.log(`[WebRTC] Received offer from ${fromUuid}`);

        let pc = connectionsRef.current.get(fromUuid);
        if (!pc) {
          pc = createConnection(fromUuid);
        }

        // Check if aborted after connection creation
        if (abortController.signal.aborted) {
          console.log(`[WebRTC] Offer handling aborted for ${fromUuid}`);
          return;
        }

        // Initialize ICE candidate buffer for this peer
        if (!iceCandidateBufferRef.current.has(fromUuid)) {
          iceCandidateBufferRef.current.set(fromUuid, []);
        }

        // Handle incoming data channel - MUST be set BEFORE setRemoteDescription
        pc.ondatachannel = (event) => {
          const dc = event.channel;

          console.log(`[WebRTC] Received DataChannel from ${fromUuid}, state: ${dc.readyState}`);

          // CRITICAL: Attach message listener IMMEDIATELY to avoid race condition
          // Messages may arrive before App.jsx's useEffect runs setupReceiver
          dc.addEventListener("message", (msgEvent) => {
            const callback = messageCallbacksRef.current.get(fromUuid);
            if (callback) {
              // Callback is registered, forward message directly
              callback(msgEvent);
            } else {
              // No callback yet, buffer the message
              console.log(`[WebRTC] Buffering message for ${fromUuid} (no callback registered yet)`);
              const buffer = messageBufferRef.current.get(fromUuid) || [];
              buffer.push(msgEvent);
              messageBufferRef.current.set(fromUuid, buffer);
            }
          });

          dc.onopen = () => {
            console.log(`[WebRTC] DataChannel opened for ${fromUuid}`);
            dataChannelsRef.current.set(fromUuid, dc);
            setDataChannels(new Map(dataChannelsRef.current));
          };

          dc.onclose = () => {
            console.log(`[WebRTC] DataChannel closed for ${fromUuid}`);
            dataChannelsRef.current.delete(fromUuid);
            setDataChannels(new Map(dataChannelsRef.current));
            // Clean up message buffer and callback
            messageBufferRef.current.delete(fromUuid);
            messageCallbacksRef.current.delete(fromUuid);
          };

          dc.onerror = (error) => {
            console.error(`[WebRTC] DataChannel error for ${fromUuid}:`, error);
          };

          dc.onstatechange = () => {
            console.log(`[WebRTC] DataChannel state changed for ${fromUuid}: ${dc.readyState}`);
          };
        };

        // Set remote description
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));

        if (abortController.signal.aborted) {
          console.log(`[WebRTC] Offer handling aborted for ${fromUuid}`);
          return;
        }

        console.log(`[WebRTC] Remote description set for ${fromUuid}`);

        // Process buffered ICE candidates now that remoteDescription is set
        const bufferedCandidates = iceCandidateBufferRef.current.get(fromUuid) || [];
        console.log(`[WebRTC] Processing ${bufferedCandidates.length} buffered ICE candidates for ${fromUuid}`);

        for (const candidate of bufferedCandidates) {
          if (abortController.signal.aborted) {
            console.log(`[WebRTC] Offer handling aborted for ${fromUuid}`);
            return;
          }

          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (error) {
            console.error(`[WebRTC] Error adding buffered ICE candidate:`, error);
          }
        }

        // Clear buffer
        iceCandidateBufferRef.current.set(fromUuid, []);

        if (abortController.signal.aborted) {
          console.log(`[WebRTC] Offer handling aborted for ${fromUuid}`);
          return;
        }

        // Create and send answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (abortController.signal.aborted) {
          console.log(`[WebRTC] Offer handling aborted for ${fromUuid}`);
          return;
        }

        console.log(`[WebRTC] Sending answer to ${fromUuid}`);
        socket.emit("webrtc-answer", {
          targetUuid: fromUuid,
          sdp: pc.localDescription,
        });
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error(`[WebRTC] Error handling offer from ${fromUuid}:`, error);
        }
      } finally {
        // Clean up abort controller
        abortControllersRef.current.delete(fromUuid);
      }
    },
    [socket, enabled, createConnection]
  );

  // Handle incoming answer
  const handleAnswer = useCallback(
    async (fromUuid, sdp) => {
      const pc = connectionsRef.current.get(fromUuid);
      if (!pc) {
        console.warn(`[WebRTC] No connection found for answer from ${fromUuid}`);
        return;
      }

      console.log(`[WebRTC] Received answer from ${fromUuid}`);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log(`[WebRTC] Remote description set for ${fromUuid}`);

      // Process buffered ICE candidates now that remoteDescription is set
      const bufferedCandidates = iceCandidateBufferRef.current.get(fromUuid) || [];
      console.log(`[WebRTC] Processing ${bufferedCandidates.length} buffered ICE candidates for ${fromUuid}`);

      for (const candidate of bufferedCandidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error(`[WebRTC] Error adding buffered ICE candidate:`, error);
        }
      }

      // Clear buffer
      iceCandidateBufferRef.current.set(fromUuid, []);
    },
    []
  );

  // Handle incoming ICE candidate with buffering and priority handling
  const handleIceCandidate = useCallback(
    async (fromUuid, candidate) => {
      const pc = connectionsRef.current.get(fromUuid);
      if (!pc) {
        console.warn(`[WebRTC] No connection found for ICE candidate from ${fromUuid}`);
        return;
      }

      // Check if remote description is set
      if (!pc.remoteDescription) {
        // Buffer the candidate until remoteDescription is set
        const buffer = iceCandidateBufferRef.current.get(fromUuid) || [];

        // Enforce maximum buffer size to prevent memory leak from malicious peers
        if (buffer.length >= MAX_ICE_CANDIDATES) {
          // Track dropped candidates for debugging
          const stats = ICE_CANDIDATE_STATS.get(fromUuid) || { dropped: 0 };
          stats.dropped++;
          ICE_CANDIDATE_STATS.set(fromUuid, stats);

          // Prioritize: keep host and srflx candidates, drop relay candidates first
          // as relay (TURN) candidates are fallback and host/srflx are preferred
          const relayIndex = buffer.findIndex(c => c.candidate && c.candidate.includes('relay'));
          if (relayIndex !== -1) {
            buffer.splice(relayIndex, 1);
            console.warn(`[WebRTC] ICE buffer full for ${fromUuid}, dropped relay candidate (total dropped: ${stats.dropped})`);
          } else {
            buffer.shift(); // Remove oldest if no relay candidates
            console.warn(`[WebRTC] ICE buffer full for ${fromUuid}, dropped oldest candidate (total dropped: ${stats.dropped})`);
          }
        }

        buffer.push(candidate);
        iceCandidateBufferRef.current.set(fromUuid, buffer);
        console.log(`[WebRTC] Buffering ICE candidate for ${fromUuid} (${buffer.length}/${MAX_ICE_CANDIDATES})`);
        return;
      }

      // Remote description is set, add candidate immediately
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log(`[WebRTC] Added ICE candidate for ${fromUuid}`);
      } catch (error) {
        console.error(`[WebRTC] Error adding ICE candidate for ${fromUuid}:`, error);
      }
    },
    []
  );

  // Close connection to a peer with graceful DataChannel drain
  const closeConnection = useCallback((peerUuid, graceful = true) => {
    console.log(`[WebRTC] Closing connection to ${peerUuid} (graceful: ${graceful})`);

    // Abort any pending async operations for this peer
    const abortController = abortControllersRef.current.get(peerUuid);
    if (abortController) {
      abortController.abort();
      abortControllersRef.current.delete(peerUuid);
    }

    const dc = dataChannelsRef.current.get(peerUuid);
    const pc = connectionsRef.current.get(peerUuid);

    // Helper to perform final cleanup
    const performCleanup = () => {
      if (pc) {
        pc.close();
        connectionsRef.current.delete(peerUuid);
        setConnections(new Map(connectionsRef.current));
      }

      if (dc) {
        dc.close();
        dataChannelsRef.current.delete(peerUuid);
        setDataChannels(new Map(dataChannelsRef.current));
      }

      // Clear ICE candidate buffer and stats
      iceCandidateBufferRef.current.delete(peerUuid);
      ICE_CANDIDATE_STATS.delete(peerUuid);

      setConnectionStates((prev) => {
        const next = new Map(prev);
        next.delete(peerUuid);
        return next;
      });
    };

    // If graceful close and DataChannel has buffered data, wait for drain
    if (graceful && dc && dc.readyState === "open" && dc.bufferedAmount > 0) {
      console.log(`[WebRTC] Waiting for DataChannel drain (${dc.bufferedAmount} bytes) for ${peerUuid}`);

      // Set a maximum wait time for drain (5 seconds)
      const drainTimeout = setTimeout(() => {
        console.warn(`[WebRTC] DataChannel drain timeout for ${peerUuid}, forcing close`);
        performCleanup();
      }, 5000);

      // Listen for buffer to drain
      const checkDrain = () => {
        if (dc.bufferedAmount === 0 || dc.readyState !== "open") {
          clearTimeout(drainTimeout);
          performCleanup();
        } else {
          setTimeout(checkDrain, 50);
        }
      };
      checkDrain();
    } else {
      // Immediate cleanup
      performCleanup();
    }
  }, []);

  // Setup socket listeners
  useEffect(() => {
    if (!socket || !enabled) return;

    socket.on("webrtc-offer", ({ fromUuid, sdp }) => {
      handleOffer(fromUuid, sdp);
    });

    socket.on("webrtc-answer", ({ fromUuid, sdp }) => {
      handleAnswer(fromUuid, sdp);
    });

    socket.on("webrtc-ice-candidate", ({ fromUuid, candidate }) => {
      handleIceCandidate(fromUuid, candidate);
    });

    // Cleanup on peer left
    socket.on("peer-left", ({ clientUuid }) => {
      if (clientUuid) {
        closeConnection(clientUuid);
      }
    });

    return () => {
      socket.off("webrtc-offer");
      socket.off("webrtc-answer");
      socket.off("webrtc-ice-candidate");
    };
  }, [socket, enabled, handleOffer, handleAnswer, handleIceCandidate, closeConnection]);

  // Cleanup all connections on unmount
  useEffect(() => {
    return () => {
      connectionsRef.current.forEach((pc) => pc.close());
      dataChannelsRef.current.forEach((dc) => dc.close());
    };
  }, []);

  return {
    connections,
    dataChannels,
    connectionStates,
    createOffer,
    closeConnection,
    registerMessageCallback,
  };
}
