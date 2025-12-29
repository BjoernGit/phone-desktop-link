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
        // For localhost testing, force using host candidates (direct connection)
        // This works when both browsers are on the same machine
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("webrtc-ice-candidate", {
            targetUuid: peerUuid,
            candidate: event.candidate,
          });
        }
      };

      // Track connection state
      pc.onconnectionstatechange = () => {
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

      let pc = connectionsRef.current.get(peerUuid);
      if (!pc) {
        pc = createConnection(peerUuid);
      }

      // Create data channel
      const dc = pc.createDataChannel("fileTransfer", {
        ordered: true,
      });

      dc.onopen = () => {
        dataChannelsRef.current.set(peerUuid, dc);
        setDataChannels(new Map(dataChannelsRef.current));
      };

      dc.onclose = () => {
        dataChannelsRef.current.delete(peerUuid);
        setDataChannels(new Map(dataChannelsRef.current));
      };

      // Create and send offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

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

      let pc = connectionsRef.current.get(fromUuid);
      if (!pc) {
        pc = createConnection(fromUuid);
      }

      // Handle incoming data channel
      pc.ondatachannel = (event) => {
        const dc = event.channel;

        dc.onopen = () => {
          dataChannelsRef.current.set(fromUuid, dc);
          setDataChannels(new Map(dataChannelsRef.current));
        };

        dc.onclose = () => {
          dataChannelsRef.current.delete(fromUuid);
          setDataChannels(new Map(dataChannelsRef.current));
        };
      };

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

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
      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    },
    []
  );

  // Handle incoming ICE candidate
  const handleIceCandidate = useCallback(
    async (fromUuid, candidate) => {
      const pc = connectionsRef.current.get(fromUuid);
      if (!pc) return;

      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error(`[WebRTC] Error adding ICE candidate:`, error);
      }
    },
    []
  );

  // Close connection to a peer
  const closeConnection = useCallback((peerUuid) => {
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
