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

  // ICE servers configuration (STUN server for NAT traversal)
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  // Create a new RTCPeerConnection for a peer
  const createConnection = useCallback(
    (peerUuid) => {
      if (!enabled || !socket) return null;

      const pc = new RTCPeerConnection({ iceServers });

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
        console.log(`WebRTC connection to ${peerUuid}: ${pc.connectionState}`);
        setConnectionStates((prev) => {
          const next = new Map(prev);
          next.set(peerUuid, pc.connectionState);
          return next;
        });

        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          // Cleanup on failure
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
        console.log(`Data channel to ${peerUuid} opened`);
        dataChannelsRef.current.set(peerUuid, dc);
        setDataChannels(new Map(dataChannelsRef.current));
      };

      dc.onclose = () => {
        console.log(`Data channel to ${peerUuid} closed`);
        dataChannelsRef.current.delete(peerUuid);
        setDataChannels(new Map(dataChannelsRef.current));
      };

      // Create and send offer
      const offer = await pc.createOffer();
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
        console.log(`Data channel from ${fromUuid} received`);

        dc.onopen = () => {
          console.log(`Data channel from ${fromUuid} opened`);
          dataChannelsRef.current.set(fromUuid, dc);
          setDataChannels(new Map(dataChannelsRef.current));
        };

        dc.onclose = () => {
          console.log(`Data channel from ${fromUuid} closed`);
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

      await pc.addIceCandidate(new RTCIceCandidate(candidate));
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
