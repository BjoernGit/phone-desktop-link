import { useEffect, useRef, useState, useCallback } from "react";

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
          // Only send if we have both local and remote descriptions set
          // This ensures proper Trickle ICE
          if (pc.localDescription && pc.remoteDescription) {
            socket.emit("webrtc-ice-candidate", {
              targetUuid: peerUuid,
              candidate: event.candidate,
            });
          }
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

  // Create offer (initiator side)
  const createOffer = useCallback(
    async (peerUuid) => {
      if (!enabled || !socket) return;

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

      dc.onopen = () => {
        console.log(`[WebRTC] DataChannel opened for ${peerUuid}`);
        dataChannelsRef.current.set(peerUuid, dc);
        setDataChannels(new Map(dataChannelsRef.current));
      };

      dc.onclose = () => {
        console.log(`[WebRTC] DataChannel closed for ${peerUuid}`);
        dataChannelsRef.current.delete(peerUuid);
        setDataChannels(new Map(dataChannelsRef.current));
      };

      dc.onerror = (error) => {
        console.error(`[WebRTC] DataChannel error for ${peerUuid}:`, error);
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
    },
    [socket, enabled, createConnection]
  );

  // Handle incoming offer (receiver side)
  const handleOffer = useCallback(
    async (fromUuid, sdp) => {
      if (!enabled || !socket) return;

      console.log(`[WebRTC] Received offer from ${fromUuid}`);

      let pc = connectionsRef.current.get(fromUuid);
      if (!pc) {
        pc = createConnection(fromUuid);
      }

      // Initialize ICE candidate buffer for this peer
      if (!iceCandidateBufferRef.current.has(fromUuid)) {
        iceCandidateBufferRef.current.set(fromUuid, []);
      }

      // Handle incoming data channel - MUST be set BEFORE setRemoteDescription
      pc.ondatachannel = (event) => {
        const dc = event.channel;

        console.log(`[WebRTC] Received DataChannel from ${fromUuid}`);

        dc.onopen = () => {
          console.log(`[WebRTC] DataChannel opened for ${fromUuid}`);
          dataChannelsRef.current.set(fromUuid, dc);
          setDataChannels(new Map(dataChannelsRef.current));
        };

        dc.onclose = () => {
          console.log(`[WebRTC] DataChannel closed for ${fromUuid}`);
          dataChannelsRef.current.delete(fromUuid);
          setDataChannels(new Map(dataChannelsRef.current));
        };

        dc.onerror = (error) => {
          console.error(`[WebRTC] DataChannel error for ${fromUuid}:`, error);
        };
      };

      // Set remote description
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

      // Create and send answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      console.log(`[WebRTC] Sending answer to ${fromUuid}`);
      socket.emit("webrtc-answer", {
        targetUuid: fromUuid,
        sdp: pc.localDescription,
      });
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

  // Handle incoming ICE candidate with buffering
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
        console.log(`[WebRTC] Buffering ICE candidate for ${fromUuid} (no remote description yet)`);
        const buffer = iceCandidateBufferRef.current.get(fromUuid) || [];
        buffer.push(candidate);
        iceCandidateBufferRef.current.set(fromUuid, buffer);
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

  // Close connection to a peer
  const closeConnection = useCallback((peerUuid) => {
    console.log(`[WebRTC] Closing connection to ${peerUuid}`);

    const pc = connectionsRef.current.get(peerUuid);
    if (pc) {
      pc.close();
      connectionsRef.current.delete(peerUuid);
      setConnections(new Map(connectionsRef.current));
    }

    const dc = dataChannelsRef.current.get(peerUuid);
    if (dc) {
      dc.close();
      dataChannelsRef.current.delete(peerUuid);
      setDataChannels(new Map(dataChannelsRef.current));
    }

    // Clear ICE candidate buffer
    iceCandidateBufferRef.current.delete(peerUuid);

    setConnectionStates((prev) => {
      const next = new Map(prev);
      next.delete(peerUuid);
      return next;
    });
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
  };
}
