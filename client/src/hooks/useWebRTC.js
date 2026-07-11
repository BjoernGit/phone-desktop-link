import { useEffect, useRef, useState, useCallback } from "react";
import {
  setupDataChannelMessageListener,
  setupDataChannelEventHandlers,
  processBufferedIceCandidates,
  createPeerConnectionConfig,
  loadRelayIceServers,
  relayIceServersReady,
  WEBRTC_CONFIG,
} from "../utils/webrtcHelpers";

const ICE_CANDIDATE_STATS = new Map(); // Track dropped candidates per peer for debugging

// Set to true for verbose WebRTC debugging
export const DEBUG_WEBRTC = false;

/**
 * WebRTC Hook for P2P file transfer
 * Manages RTCPeerConnection and DataChannel setup
 */
export function useWebRTC({ socket, clientUuid, enabled = true }) {
  const [connections, setConnections] = useState(new Map());
  const [dataChannels, setDataChannels] = useState(new Map());
  const [connectionStates, setConnectionStates] = useState(new Map());

  const connectionsRef = useRef(new Map());
  const dataChannelsRef = useRef(new Map());
  const iceCandidateBufferRef = useRef(new Map());
  const abortControllersRef = useRef(new Map());
  const messageBufferRef = useRef(new Map());
  const messageCallbacksRef = useRef(new Map());
  const closeConnectionRef = useRef(null); // Ref to avoid circular dependency

  // Fetch TURN relay credentials once so peer connections can use them
  useEffect(() => {
    if (socket && enabled) {
      loadRelayIceServers(socket);
    }
  }, [socket, enabled]);

  // Create a new RTCPeerConnection for a peer
  const createConnection = useCallback(
    (peerUuid) => {
      if (!enabled || !socket) return null;

      const pc = new RTCPeerConnection(createPeerConnectionConfig());

      // Handle ICE candidates - send to peer via signaling
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          if (DEBUG_WEBRTC) console.log(`[WebRTC] Sending ICE candidate to ${peerUuid}`);
          socket.emit("webrtc-ice-candidate", {
            targetUuid: peerUuid,
            candidate: event.candidate,
          });
        }
      };

      // Track ICE connection state
      pc.oniceconnectionstatechange = () => {
        if (DEBUG_WEBRTC) console.log(`[WebRTC] ICE state for ${peerUuid}: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === "failed") {
          console.error(`[WebRTC] ICE connection failed for ${peerUuid}`);
        }
      };

      // Track ICE gathering state (verbose)
      if (DEBUG_WEBRTC) {
        pc.onicegatheringstatechange = () => {
          console.log(`[WebRTC] ICE gathering state for ${peerUuid}: ${pc.iceGatheringState}`);
        };
      }

      // Track connection state
      pc.onconnectionstatechange = () => {
        if (DEBUG_WEBRTC) console.log(`[WebRTC] Connection state for ${peerUuid}: ${pc.connectionState}`);
        // Ignore events from superseded connections (glare can leave an
        // orphaned RTCPeerConnection behind) - a dying orphan must not
        // report state for the peer or tear down the active connection.
        if (connectionsRef.current.get(peerUuid) !== pc) return;
        setConnectionStates((prev) => {
          const next = new Map(prev);
          next.set(peerUuid, pc.connectionState);
          return next;
        });
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          // Use ref to avoid circular dependency
          if (closeConnectionRef.current) {
            closeConnectionRef.current(peerUuid);
          }
        }
      };

      connectionsRef.current.set(peerUuid, pc);
      setConnections(new Map(connectionsRef.current));

      return pc;
    },
    [socket, enabled]
  );

  // Register a message callback for a peer's DataChannel
  const registerMessageCallback = useCallback((peerUuid, callback) => {
    if (DEBUG_WEBRTC) console.log(`[WebRTC] Registering message callback for ${peerUuid}`);
    messageCallbacksRef.current.set(peerUuid, callback);

    // Deliver any buffered messages immediately
    const bufferedMessages = messageBufferRef.current.get(peerUuid) || [];
    if (bufferedMessages.length > 0) {
      if (DEBUG_WEBRTC) console.log(
        `[WebRTC] Delivering ${bufferedMessages.length} buffered messages for ${peerUuid}`
      );
      bufferedMessages.forEach((msg) => callback(msg));
      messageBufferRef.current.delete(peerUuid);
    }

    return () => {
      messageCallbacksRef.current.delete(peerUuid);
    };
  }, []);

  // Create offer (initiator side)
  const createOffer = useCallback(
    async (peerUuid, timeoutMs = WEBRTC_CONFIG.DEFAULT_OFFER_TIMEOUT_MS) => {
      if (!enabled || !socket) return null;

      // Check if we already have an open DataChannel
      const existingDc = dataChannelsRef.current.get(peerUuid);
      if (existingDc && existingDc.readyState === "open") {
        if (DEBUG_WEBRTC) console.log(
          `[WebRTC] Already have open DataChannel for ${peerUuid}, skipping offer`
        );
        return existingDc;
      }

      if (DEBUG_WEBRTC) console.log(`[WebRTC] Creating offer for ${peerUuid}`);

      // Make sure TURN credentials (if any) are in before gathering ICE
      await relayIceServersReady();

      // Check if there's an existing connection in a bad state - close it first
      let pc = connectionsRef.current.get(peerUuid);
      if (pc) {
        const badStates = ["failed", "closed", "disconnected"];
        if (badStates.includes(pc.connectionState) || badStates.includes(pc.iceConnectionState)) {
          if (DEBUG_WEBRTC) console.log(`[WebRTC] Closing stale connection for ${peerUuid} (state: ${pc.connectionState}, ice: ${pc.iceConnectionState})`);
          pc.close();
          connectionsRef.current.delete(peerUuid);
          dataChannelsRef.current.delete(peerUuid);
          iceCandidateBufferRef.current.delete(peerUuid);
          pc = null;
        }
      }

      if (!pc) {
        pc = createConnection(peerUuid);
      }

      // Initialize ICE candidate buffer for this peer (clear any old candidates)
      iceCandidateBufferRef.current.set(peerUuid, []);

      // Create data channel BEFORE creating offer
      const dc = pc.createDataChannel("fileTransfer", { ordered: true });
      if (DEBUG_WEBRTC) console.log(
        `[WebRTC] DataChannel created for ${peerUuid}, initial state: ${dc.readyState}`
      );

      // Setup message listener with buffering (extracted helper)
      setupDataChannelMessageListener(
        dc,
        peerUuid,
        messageCallbacksRef,
        messageBufferRef
      );

      // Create promise that resolves when DataChannel opens
      const dataChannelReady = new Promise((resolve) => {
        let resolved = false;

        const timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.warn(
              `[WebRTC] DataChannel open timeout for ${peerUuid} after ${timeoutMs}ms`
            );
            resolve(null);
          }
        }, timeoutMs);

        // Setup event handlers with open callback (extracted helper)
        setupDataChannelEventHandlers(dc, peerUuid, {
          dataChannelsRef,
          setDataChannels,
          messageBufferRef,
          messageCallbacksRef,
          onOpenCallback: (openedDc) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutId);
              resolve(openedDc);
            }
          },
        });

        // If already open (unlikely but possible)
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

      // Create and send offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

      if (DEBUG_WEBRTC) console.log(`[WebRTC] Sending offer to ${peerUuid}`);
      socket.emit("webrtc-offer", {
        targetUuid: peerUuid,
        sdp: pc.localDescription,
      });

      return dataChannelReady;
    },
    [socket, enabled, createConnection]
  );

  // Handle incoming offer (receiver side)
  const handleOffer = useCallback(
    async (fromUuid, sdp) => {
      if (!enabled || !socket) return;

      const abortController = new AbortController();
      abortControllersRef.current.set(fromUuid, abortController);

      try {
        if (abortController.signal.aborted) return;

        if (DEBUG_WEBRTC) console.log(`[WebRTC] Received offer from ${fromUuid}`);

        // Make sure TURN credentials (if any) are in before gathering ICE
        await relayIceServersReady();
        if (abortController.signal.aborted) return;

        // Check if there's an existing connection - for a new offer, we should start fresh
        let pc = connectionsRef.current.get(fromUuid);
        if (pc) {
          // Only reset if connection is truly dead or in conflicting signaling state
          // "disconnected" is temporary and may recover, don't reset aggressively
          const deadStates = ["failed", "closed"];
          const signalingConflict = pc.signalingState !== "stable" && pc.signalingState !== "closed";
          const needsReset = deadStates.includes(pc.connectionState) ||
                            deadStates.includes(pc.iceConnectionState) ||
                            signalingConflict;

          if (needsReset) {
            if (DEBUG_WEBRTC) console.log(`[WebRTC] Resetting connection for new offer from ${fromUuid} (signaling: ${pc.signalingState}, state: ${pc.connectionState})`);
            pc.close();
            connectionsRef.current.delete(fromUuid);
            dataChannelsRef.current.delete(fromUuid);
            iceCandidateBufferRef.current.delete(fromUuid);
            pc = null;
          } else {
            if (DEBUG_WEBRTC) console.log(`[WebRTC] Reusing existing connection for ${fromUuid} (signaling: ${pc.signalingState}, state: ${pc.connectionState})`);
          }
        }

        if (!pc) {
          pc = createConnection(fromUuid);
        }

        if (abortController.signal.aborted) return;

        // Initialize ICE candidate buffer (clear any old candidates for fresh start)
        iceCandidateBufferRef.current.set(fromUuid, []);

        // Handle incoming data channel - MUST be set BEFORE setRemoteDescription
        pc.ondatachannel = (event) => {
          const dc = event.channel;
          if (DEBUG_WEBRTC) console.log(
            `[WebRTC] Received DataChannel from ${fromUuid}, state: ${dc.readyState}`
          );

          // Setup message listener with buffering (extracted helper)
          setupDataChannelMessageListener(
            dc,
            fromUuid,
            messageCallbacksRef,
            messageBufferRef
          );

          // Setup event handlers (extracted helper)
          setupDataChannelEventHandlers(dc, fromUuid, {
            dataChannelsRef,
            setDataChannels,
            messageBufferRef,
            messageCallbacksRef,
          });
        };

        // Set remote description
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        if (abortController.signal.aborted) return;

        if (DEBUG_WEBRTC) console.log(`[WebRTC] Remote description set for ${fromUuid}`);

        // Process buffered ICE candidates (extracted helper)
        await processBufferedIceCandidates(
          pc,
          fromUuid,
          iceCandidateBufferRef,
          abortController.signal
        );

        if (abortController.signal.aborted) return;

        // Create and send answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (abortController.signal.aborted) return;

        if (DEBUG_WEBRTC) console.log(`[WebRTC] Sending answer to ${fromUuid}`);
        socket.emit("webrtc-answer", {
          targetUuid: fromUuid,
          sdp: pc.localDescription,
        });
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error(`[WebRTC] Error handling offer from ${fromUuid}:`, error);
        }
      } finally {
        abortControllersRef.current.delete(fromUuid);
      }
    },
    [socket, enabled, createConnection]
  );

  // Handle incoming answer
  const handleAnswer = useCallback(async (fromUuid, sdp) => {
    const pc = connectionsRef.current.get(fromUuid);
    if (!pc) {
      console.warn(`[WebRTC] No connection found for answer from ${fromUuid}`);
      return;
    }

    if (DEBUG_WEBRTC) console.log(`[WebRTC] Received answer from ${fromUuid}`);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    if (DEBUG_WEBRTC) console.log(`[WebRTC] Remote description set for ${fromUuid}`);

    // Process buffered ICE candidates (extracted helper)
    await processBufferedIceCandidates(pc, fromUuid, iceCandidateBufferRef);
  }, []);

  // Handle incoming ICE candidate with buffering and priority handling
  const handleIceCandidate = useCallback(async (fromUuid, candidate) => {
    const pc = connectionsRef.current.get(fromUuid);
    if (!pc) {
      console.warn(
        `[WebRTC] No connection found for ICE candidate from ${fromUuid}`
      );
      return;
    }

    // Check if remote description is set
    if (!pc.remoteDescription) {
      const buffer = iceCandidateBufferRef.current.get(fromUuid) || [];

      // Enforce maximum buffer size
      if (buffer.length >= WEBRTC_CONFIG.MAX_ICE_CANDIDATES) {
        const stats = ICE_CANDIDATE_STATS.get(fromUuid) || { dropped: 0 };
        stats.dropped++;
        ICE_CANDIDATE_STATS.set(fromUuid, stats);

        // Prioritize: keep host and srflx, drop relay first
        const relayIndex = buffer.findIndex(
          (c) => c.candidate && c.candidate.includes("relay")
        );
        if (relayIndex !== -1) {
          buffer.splice(relayIndex, 1);
          console.warn(
            `[WebRTC] ICE buffer full for ${fromUuid}, dropped relay candidate (total dropped: ${stats.dropped})`
          );
        } else {
          buffer.shift();
          console.warn(
            `[WebRTC] ICE buffer full for ${fromUuid}, dropped oldest candidate (total dropped: ${stats.dropped})`
          );
        }
      }

      buffer.push(candidate);
      iceCandidateBufferRef.current.set(fromUuid, buffer);
      if (DEBUG_WEBRTC) console.log(
        `[WebRTC] Buffering ICE candidate for ${fromUuid} (${buffer.length}/${WEBRTC_CONFIG.MAX_ICE_CANDIDATES})`
      );
      return;
    }

    // Remote description is set, add candidate immediately
    try {
      // Check connection state before adding - ignore if connection is dead
      if (pc.connectionState === "closed" || pc.connectionState === "failed") {
        if (DEBUG_WEBRTC) console.log(`[WebRTC] Ignoring ICE candidate for ${fromUuid} - connection ${pc.connectionState}`);
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      if (DEBUG_WEBRTC) console.log(`[WebRTC] Added ICE candidate for ${fromUuid}`);
    } catch (error) {
      // Ignore "Unknown ufrag" errors - they happen when candidates arrive for old sessions
      if (error.message?.includes("Unknown ufrag") || error.message?.includes("unknown ufrag")) {
        if (DEBUG_WEBRTC) console.log(`[WebRTC] Ignoring stale ICE candidate for ${fromUuid} (unknown ufrag)`);
        return;
      }
      console.error(
        `[WebRTC] Error adding ICE candidate for ${fromUuid}:`,
        error
      );
    }
  }, []);

  // Close connection to a peer with graceful DataChannel drain
  const closeConnection = useCallback((peerUuid, graceful = true) => {
    if (DEBUG_WEBRTC) console.log(
      `[WebRTC] Closing connection to ${peerUuid} (graceful: ${graceful})`
    );

    // Abort any pending async operations
    const abortController = abortControllersRef.current.get(peerUuid);
    if (abortController) {
      abortController.abort();
      abortControllersRef.current.delete(peerUuid);
    }

    const dc = dataChannelsRef.current.get(peerUuid);
    const pc = connectionsRef.current.get(peerUuid);

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
      iceCandidateBufferRef.current.delete(peerUuid);
      ICE_CANDIDATE_STATS.delete(peerUuid);
      setConnectionStates((prev) => {
        const next = new Map(prev);
        next.delete(peerUuid);
        return next;
      });
    };

    // Graceful close with drain wait
    if (graceful && dc && dc.readyState === "open" && dc.bufferedAmount > 0) {
      if (DEBUG_WEBRTC) console.log(
        `[WebRTC] Waiting for DataChannel drain (${dc.bufferedAmount} bytes) for ${peerUuid}`
      );

      const drainTimeout = setTimeout(() => {
        if (DEBUG_WEBRTC) console.warn(
          `[WebRTC] DataChannel drain timeout for ${peerUuid}, forcing close`
        );
        performCleanup();
      }, WEBRTC_CONFIG.DRAIN_TIMEOUT_MS);

      const checkDrain = () => {
        if (dc.bufferedAmount === 0 || dc.readyState !== "open") {
          clearTimeout(drainTimeout);
          performCleanup();
        } else {
          setTimeout(checkDrain, WEBRTC_CONFIG.DRAIN_CHECK_INTERVAL_MS);
        }
      };
      checkDrain();
    } else {
      performCleanup();
    }
  }, []);

  // Keep closeConnectionRef in sync with closeConnection
  closeConnectionRef.current = closeConnection;

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

    socket.on("peer-left", ({ clientUuid }) => {
      if (clientUuid) {
        closeConnection(clientUuid);
      }
    });

    return () => {
      socket.off("webrtc-offer");
      socket.off("webrtc-answer");
      socket.off("webrtc-ice-candidate");
      socket.off("peer-left");
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
