import React, { useState, useRef, useEffect, useCallback } from "react";
import { Replayer } from "rrweb";
import "./App.css";
import {
  cutRecording,
  trimRecording,
  analyzeRecording,
  findEventsByContent,
  timestampToRelativeTime,
  formatTime,
  parseTimeString,
} from "./RecordingCutter";
import { RRWebEvent, RecordingStats, EventType } from "./types/rrweb";

// Type definitions for component state
interface EventTypeInfo {
  name: string;
  color: string;
  symbol: string;
  subType?: string;
}

interface EventMarker {
  timestamp: number;
  type: number;
  data?: any;
  relativeTime: number;
  percentage: number;
  typeInfo: EventTypeInfo;
  count?: number;
  grouped?: boolean;
}

interface SnackbarState {
  message: string;
  type: "error" | "success" | "info" | "warning";
}

// Event type mapping for rrweb
const getEventTypeInfo = (event: RRWebEvent): EventTypeInfo => {
  const eventTypes: Record<number, EventTypeInfo> = {
    [EventType.DomContentLoaded]: { name: "DomContentLoaded", color: "#4CAF50", symbol: "📄" },
    [EventType.Load]: { name: "Load", color: "#2196F3", symbol: "✅" },
    [EventType.FullSnapshot]: { name: "FullSnapshot", color: "#FF9800", symbol: "📸" },
    [EventType.IncrementalSnapshot]: { name: "IncrementalSnapshot", color: "#9C27B0", symbol: "🔄" },
    [EventType.Meta]: { name: "Meta", color: "#795548", symbol: "ℹ️" },
    [EventType.Custom]: { name: "Custom", color: "#607D8B", symbol: "⭐" },
  };

  const baseInfo = eventTypes[event.type] || {
    name: "Unknown",
    color: "#666",
    symbol: "❓",
  };

  // Add more detail for incremental snapshots
  if (event.type === EventType.IncrementalSnapshot && event.data) {
    const source = event.data.source;
    const sourceNames: Record<number, string> = {
      0: "Mutation",
      1: "MouseMove",
      2: "MouseInteraction",
      3: "Scroll",
      4: "ViewportResize",
      5: "Input",
      6: "TouchMove",
      7: "MediaInteraction",
      8: "StyleSheetRule",
      9: "CanvasMutation",
      10: "Font",
      11: "Log",
      12: "Drag",
      13: "StyleDeclaration",
    };

    if (sourceNames[source] !== undefined) {
      return {
        ...baseInfo,
        name: `${baseInfo.name} (${sourceNames[source]})`,
        subType: sourceNames[source],
      };
    }
  }

  return baseInfo;
};

// Snackbar Component
interface SnackbarProps {
  message: string;
  type: "error" | "success" | "info" | "warning";
  onClose: () => void;
}

const Snackbar: React.FC<SnackbarProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 5000); // Auto close after 5 seconds

    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`snackbar ${type}`}>
      <span>{message}</span>
      <button className="snackbar-close" onClick={onClose}>
        ×
      </button>
    </div>
  );
};

const App: React.FC = () => {
  const [events, setEvents] = useState<RRWebEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [recording, setRecording] = useState<RecordingStats | null>(null); // Analysis of current recording
  const [cutTimestamp, setCutTimestamp] = useState<string>("");
  const [beforeSeconds, setBeforeSeconds] = useState<number>(5);
  const [afterSeconds, setAfterSeconds] = useState<number>(5);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [foundEvents, setFoundEvents] = useState<RRWebEvent[]>([]);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const replayer = useRef<Replayer | null>(null);

  // Player timeline states
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isTrimmingMode, setIsTrimmingMode] = useState<boolean>(false);
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(0);
  const timelineUpdateInterval = useRef<NodeJS.Timeout | null>(null);
  const [eventMarkers, setEventMarkers] = useState<EventMarker[]>([]);
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);

  // Helper function to safely clear interval
  const clearTimelineInterval = () => {
    if (timelineUpdateInterval.current) {
      clearInterval(timelineUpdateInterval.current);
      timelineUpdateInterval.current = null;
    }
  };

  const processEventMarkers = (eventsArray: RRWebEvent[], recordingAnalysis: RecordingStats): EventMarker[] => {
    if (!eventsArray || !recordingAnalysis) return [];

    const startTime = recordingAnalysis.startTime;
    const markers: EventMarker[] = [];

    // Only show significant events: Full snapshots, major interactions, and occasional incremental snapshots
    const significantEvents = eventsArray.filter((event) => {
      // Always show full snapshots
      if (event.type === EventType.FullSnapshot) return true;

      // Show meta events
      if (event.type === EventType.Meta) return true;

      // For incremental snapshots, only show mouse clicks, scrolls, and viewport resizes
      if (event.type === EventType.IncrementalSnapshot && event.data) {
        const source = event.data.source;
        return source === 2 || source === 3 || source === 4; // MouseInteraction, Scroll, ViewportResize
      }

      return false;
    });

    // Group events by time ranges (every 1% of timeline)
    const eventsByTimeRange: Record<number, EventMarker[]> = {};

    significantEvents.forEach((event) => {
      const relativeTime = event.timestamp - startTime;
      // Convert duration from seconds to milliseconds for correct calculation
      const percentage =
        (relativeTime / (recordingAnalysis.duration * 1000)) * 100;

      const timeRange = Math.floor(percentage); // Group by 1% ranges

      if (!eventsByTimeRange[timeRange]) {
        eventsByTimeRange[timeRange] = [];
      }

      eventsByTimeRange[timeRange].push({
        ...event,
        relativeTime,
        percentage,
        typeInfo: getEventTypeInfo(event),
      });
    });

    // Convert to markers, only one per time range
    Object.entries(eventsByTimeRange).forEach(([timeRange, events]) => {
      if (events.length === 1) {
        markers.push(events[0]);
      } else {
        // Multiple events in same time range - create a grouped marker
        const representative = events[0];
        markers.push({
          ...representative,
          count: events.length,
          grouped: true,
        });
      }
    });

    return markers.sort((a, b) => a.timestamp - b.timestamp);
  };

  // Helper function to show notifications
  const showNotification = (message: string, type: "error" | "success" | "info" | "warning" = "error") => {
    setSnackbar({ message, type });
  };

  const handleFileUpload = (file: File) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      try {
        const content = e.target?.result;
        if (!content) {
          throw new Error("Failed to read file content");
        }

        let jsonData: any;

        if (typeof content === "string") {
          jsonData = JSON.parse(content);
        } else {
          // Handle binary content
          const text = new TextDecoder().decode(content as ArrayBuffer);
          jsonData = JSON.parse(text);
        }

        // Debug: Log the raw data structure
        console.log("Raw JSON data:", jsonData);
        console.log("Data type:", typeof jsonData);
        console.log("Is array:", Array.isArray(jsonData));

        // Handle different rrweb recording formats
        let eventsArray: RRWebEvent[];
        if (Array.isArray(jsonData)) {
          eventsArray = jsonData;
        } else if (jsonData.events && Array.isArray(jsonData.events)) {
          // Some recordings store events in a nested structure
          eventsArray = jsonData.events;
        } else if (jsonData.data && Array.isArray(jsonData.data)) {
          eventsArray = jsonData.data;
        } else {
          // Single event wrapped in array
          eventsArray = [jsonData];
        }

        console.log("Processed events array:", eventsArray.length, "events");
        console.log("First few events:", eventsArray.slice(0, 3));

        // Basic validation
        if (!eventsArray || eventsArray.length === 0) {
          showNotification(
            "Invalid recording format: no events found",
            "error"
          );
          return;
        }

        // Analyze the recording
        const analysis = analyzeRecording(eventsArray);
        if (!analysis) {
          showNotification("Unable to analyze recording", "error");
          return;
        }

        setRecording(analysis);
        setEvents(eventsArray);
        setError(null);
        console.log("Recording loaded:", analysis);

        // Process event markers
        const markers = processEventMarkers(eventsArray, analysis);
        setEventMarkers(markers);

        showNotification("Recording loaded successfully", "success");
      } catch (err) {
        console.error("Error parsing file:", err);
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        showNotification(
          `Error loading file: ${errorMessage}. Please make sure the file contains valid rrweb recording data.`,
          "error"
        );
      }
    };

    reader.onerror = () => {
      showNotification("Error reading file. Please try again.", "error");
    };

    reader.readAsText(file);
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const initializePlayer = useCallback(() => {
    if (!events || !playerRef.current) return;

    try {
      // Clean up existing replayer
      if (replayer.current) {
        try {
          replayer.current.destroy();
        } catch (destroyError) {
          console.warn("Error destroying previous replayer:", destroyError);
        }
        replayer.current = null;
      }

      // Clean up intervals
      clearTimelineInterval();

      // Ensure player container is clean
      if (playerRef.current) {
        playerRef.current.innerHTML = "";
      }

      // Simple logging
      console.log("Events to replay:", events.length);

      // Get duration from events
      const timestamps = events.map((e) => e.timestamp || 0);
      const calculatedDuration =
        Math.max(...timestamps) - Math.min(...timestamps);
      console.log("Calculated duration:", calculatedDuration, "ms");

      // Create replayer with simple configuration
      replayer.current = new Replayer(events, {
        root: playerRef.current,
        skipInactive: false,
        showWarning: false,
        blockClass: "rr-block",
        liveMode: false,
        triggerFocus: false,

        speed: 1.0,
        mouseTail: false,
        insertStyleRules: [
          ".rr-block { background: rgba(0, 0, 0, 0.1); }",
          "iframe { background: white !important; }",
        ],
      });

      // Add basic event listeners
      replayer.current.on("finish", () => {
        setIsPlaying(false);
        clearTimelineInterval();
      });

      // Get duration
      let totalDuration = calculatedDuration;
      try {
        const metadata = replayer.current.getMetaData();
        if (metadata.totalTime && metadata.totalTime > 0) {
          totalDuration = metadata.totalTime;
        }
      } catch (metaError) {
        console.warn("Could not get metadata, using calculated duration");
      }

      setDuration(totalDuration);
      setTrimEnd(totalDuration);
      setCurrentTime(0);
      setIsPlaying(false);

      // Initialize at beginning
      replayer.current.play(0);
      replayer.current.pause();

      console.log("Player initialized successfully");
    } catch (error) {
      console.error("Error initializing player:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setError(`Error initializing player: ${errorMessage}`);
    }
  }, [events]);

  useEffect(() => {
    if (events && playerRef.current) {
      initializePlayer();
    }

    // Cleanup on unmount or events change
    return () => {
      clearTimelineInterval();

      if (replayer.current) {
        try {
          replayer.current.destroy();
        } catch (destroyError) {
          console.warn("Error destroying replayer on cleanup:", destroyError);
        }
        replayer.current = null;
      }

      setIsPlaying(false);
      setCurrentTime(0);
    };
  }, [initializePlayer]);

  const handlePlay = () => {
    console.log("Play button clicked");

    if (replayer.current && duration > 0) {
      try {
        // Clear any existing interval
        clearTimelineInterval();

        // If at the end, restart from beginning
        if (currentTime >= duration - 100) {
          setCurrentTime(0);
          replayer.current.play(0);
        } else {
          replayer.current.play(currentTime);
        }

        setIsPlaying(true);

        // Start timeline updates - moved after setIsPlaying
        timelineUpdateInterval.current = setInterval(() => {
          if (replayer.current) {
            try {
              const time = replayer.current.getCurrentTime();
              console.log("Timeline update - current time:", time, "ms");
              setCurrentTime(time);

              if (time >= duration - 50) {
                console.log("Reached end of playback");
                setIsPlaying(false);
                clearTimelineInterval();
              }
            } catch (timeError) {
              console.warn("Error getting current time:", timeError);
            }
                      } else {
              console.warn("Replayer instance lost");
              setIsPlaying(false);
              clearTimelineInterval();
            }
        }, 100);

        console.log("Play setup completed, timeline updates started");
      } catch (playError) {
        console.error("Error during play:", playError);
        const errorMessage = playError instanceof Error ? playError.message : "Unknown error";
        setError(`Play error: ${errorMessage}`);
        setIsPlaying(false);
      }
    } else {
      console.warn("Cannot play - missing replayer or invalid duration");
    }
  };

  const handlePause = () => {
    console.log("Pause button clicked");
    console.log("Replayer exists:", !!replayer.current);
    console.log("Is playing:", isPlaying);

    if (replayer.current) {
      try {
        console.log("Attempting to pause");
        replayer.current.pause();
        setIsPlaying(false);
        console.log("Pause command sent successfully");

        // Clear the timeline update interval
        clearTimelineInterval();
        console.log("Timeline update interval cleared");
      } catch (pauseError) {
        console.error("Error during pause:", pauseError);
        const errorMessage = pauseError instanceof Error ? pauseError.message : "Unknown error";
        setError(`Pause error: ${errorMessage}`);
      }
    } else {
      console.error("No replayer instance available for pause");
    }
  };

  const handleStop = () => {
    if (replayer.current) {
      try {
        replayer.current.pause();
        // Reset to beginning
        replayer.current.play(0);
        replayer.current.pause();
        setIsPlaying(false);
        setCurrentTime(0);
        // Stop updating timeline
        clearTimelineInterval();
        console.log("Stopped and reset to beginning");
      } catch (error) {
        console.error("Error stopping playback:", error);
      }
    }
  };

  const handleSeek = (time: number) => {
    if (replayer.current) {
      try {
        const wasPlaying = isPlaying;

        // Pause first if playing
        if (isPlaying) {
          replayer.current.pause();
          clearTimelineInterval();
        }

        // Seek to the new time
        replayer.current.play(time);

        // Pause immediately after seeking if we weren't playing
        if (!wasPlaying) {
          replayer.current.pause();
        } else {
          // Continue playing if we were playing before
          setIsPlaying(true);
          timelineUpdateInterval.current = setInterval(() => {
            if (replayer.current && isPlaying) {
              const currentReplayTime = replayer.current.getCurrentTime();
              setCurrentTime(currentReplayTime);

              // Check if we've reached the end
              if (currentReplayTime >= duration) {
                setIsPlaying(false);
                clearTimelineInterval();
              }
            }
          }, 50);
        }

        setCurrentTime(time);
        console.log("Seeked to time:", time);
      } catch (error) {
        console.error("Error seeking:", error);
      }
    }
  };

  const handleStartTrimming = () => {
    setIsTrimmingMode(true);
    const endTime = Math.min(duration, Math.max(currentTime + 1000, duration));

    // If we're too close to the end, adjust the start time
    if (duration - currentTime < 1000) {
      setTrimStart(Math.max(0, duration - 1000));
      setTrimEnd(duration);
    } else {
      setTrimStart(currentTime);
      setTrimEnd(endTime);
    }
  };

  const handleSaveTrim = async () => {
    if (!events || !recording) {
      showNotification("No recording loaded", "error");
      return;
    }

    // Validate trim range
    if (trimEnd <= trimStart) {
      showNotification("End time must be after start time", "error");
      return;
    }

    if (trimEnd - trimStart < 100) {
      showNotification("Trim duration must be at least 0.1 seconds", "error");
      return;
    }

    try {
      showNotification(
        "Creating trimmed recording... This may take a moment.",
        "info"
      );

      // IMPORTANT: trimStart and trimEnd are relative times (ms from start of recording)
      // but trimRecording expects absolute timestamps, so we need to convert them
      const recordingStart = events[0].timestamp;
      const absoluteStartMs = recordingStart + trimStart;
      const absoluteEndMs = recordingStart + trimEnd;

      console.log(
        `Trimming: relative start=${trimStart}ms (${formatTime(
          trimStart / 1000
        )}), end=${trimEnd}ms (${formatTime(trimEnd / 1000)})`
      );
      console.log(`Recording starts at ${recordingStart}ms`);
      console.log(
        `Absolute timestamps: start=${absoluteStartMs}ms, end=${absoluteEndMs}ms`
      );

      // Use the new trimRecording function with absolute timestamps
      const clip = await trimRecording(events, absoluteStartMs, absoluteEndMs);

      // Convert milliseconds to seconds for the filename
      const startSeconds = trimStart / 1000;
      const endSeconds = trimEnd / 1000;

      // Download the trimmed clip
      const dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(clip, null, 2));
      const downloadAnchorNode = document.createElement("a");
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute(
        "download",
        `trimmed_${formatTime(startSeconds)}_to_${formatTime(endSeconds)}.json`
      );
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();

      setIsTrimmingMode(false);
      showNotification(
        `Recording trimmed successfully (${formatTime(
          startSeconds
        )} - ${formatTime(
          endSeconds
        )}). The playback starts exactly at ${formatTime(startSeconds)}.`,
        "success"
      );
    } catch (err) {
      console.error("Error trimming recording:", err);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      showNotification(`Error trimming recording: ${errorMessage}`, "error");
    }
  };

  const handleCancelTrim = () => {
    setIsTrimmingMode(false);
    setTrimStart(0);
    setTrimEnd(duration);
  };

  const handleTrimHandleChange = (type: "start" | "end", value: number) => {
    if (type === "start") {
      setTrimStart(Math.max(0, Math.min(value, trimEnd - 1000))); // Ensure at least 1 second
    } else {
      setTrimEnd(Math.max(trimStart + 1000, Math.min(value, duration)));
    }
  };

  const handleCut = (action: "load" | "download") => {
    if (!events || !recording) {
      showNotification("No recording loaded", "error");
      return;
    }

    try {
      const relativeSeconds = parseTimeString(cutTimestamp);
      const clip = cutRecording(
        events,
        relativeSeconds,
        beforeSeconds,
        afterSeconds
      );

      if (action === "load") {
        // Replace current recording with the clip
        setEvents(clip);
        const analysis = analyzeRecording(clip);
        setRecording(analysis);
        setCutTimestamp("");
        setFoundEvents([]);

        if (analysis) {
          // Process event markers for the clip
          const markers = processEventMarkers(clip, analysis);
          setEventMarkers(markers);
        }

        showNotification("Clip loaded successfully", "success");
      } else if (action === "download") {
        // Download the clip as JSON
        const dataStr =
          "data:text/json;charset=utf-8," +
          encodeURIComponent(JSON.stringify(clip, null, 2));
        const downloadAnchorNode = document.createElement("a");
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute(
          "download",
          `clip_${cutTimestamp || "segment"}.json`
        );
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();

        showNotification("Clip downloaded successfully", "success");
      }
    } catch (err) {
      console.error("Error cutting recording:", err);
      if (err instanceof Error) {
        showNotification(`Error cutting recording: ${err.message}`, "error");
      } else {
        showNotification("An unknown error occurred while cutting.", "error");
      }
    }
  };

  const handleTimelineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    console.log("Timeline slider changed to:", newTime, "ms");

    if (replayer.current && duration > 0) {
      try {
        // Ensure we don't go beyond the recording bounds
        const clampedTime = Math.max(0, Math.min(newTime, duration));
        console.log("Seeking to time:", clampedTime);

        // Always pause before seeking to avoid issues
        const wasPlaying = isPlaying;
        if (isPlaying) {
          replayer.current.pause();
          setIsPlaying(false);
          clearTimelineInterval();
        }

        // Seek to the new position
        replayer.current.play(clampedTime);
        replayer.current.pause(); // Immediately pause to stop at exact position
        setCurrentTime(clampedTime);

        // Resume playing if it was playing before
        if (wasPlaying && clampedTime < duration - 50) {
          setTimeout(() => {
            handlePlay(); // Resume playback
          }, 100);
        }

        console.log("Successfully seeked to:", clampedTime);
      } catch (seekError) {
        console.error("Error seeking:", seekError);
        if (seekError instanceof Error) {
          setError(`Seek error: ${seekError.message}`);
        } else {
          setError("An unknown error occurred while seeking.");
        }
      }
    }
  };

  return (
    <div className="app">
      <div className="header">
        <h1>RRWeb Player</h1>
        <p>Upload an rrweb recording file to play it back</p>
      </div>

      <div className="upload-section">
        <div
          className="upload-area"
          onDrop={handleFileDrop}
          onDragOver={handleDragOver}
        >
          <input
            type="file"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleFileUpload(e.target.files[0]);
              }
            }}
            className="file-input"
            id="file-upload"
          />
          <label htmlFor="file-upload" className="upload-label">
            <div className="upload-icon">📁</div>
            <div className="upload-text">
              <strong>Choose a file</strong> or drag it here
            </div>
            <div className="upload-subtext">
              Supports rrweb recording files (with or without .json extension)
            </div>
          </label>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {recording && (
        <div className="recording-info">
          <h3>Recording Information</h3>
          <div className="recording-stats">
            <div className="stat">
              <span className="stat-label">Duration:</span>
              <span className="stat-value">
                {formatTime(recording.duration)}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Events:</span>
              <span className="stat-value">{recording.totalEvents}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Start:</span>
              <span className="stat-value">
                {new Date(recording.startTime).toLocaleTimeString()}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">End:</span>
              <span className="stat-value">
                {new Date(recording.endTime).toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {events && (
        <div className="player-section">
          <div ref={playerRef} className="player"></div>

          <div className="custom-controls">
            <div className="timeline-container">
              <div
                className="timeline"
                onClick={(e) => {
                  if (!isTrimmingMode && e.target === e.currentTarget) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const percentage = x / rect.width;
                    const seekTime = percentage * duration;
                    handleSeek(seekTime);
                  }
                }}
              >
                <div
                  className="timeline-progress"
                  style={{ width: `${(currentTime / duration) * 100}%` }}
                />

                {/* Event markers */}
                <div className="event-markers-container">
                  {eventMarkers.map((marker, index) => (
                    <div
                      key={`${marker.timestamp}-${index}`}
                      className={`event-marker ${
                        marker.grouped ? "grouped" : ""
                      }`}
                      style={{
                        left: `${marker.percentage}%`,
                        backgroundColor: marker.typeInfo.color,
                      }}
                      title={`${marker.typeInfo.name}${
                        marker.grouped ? ` (${marker.count} events)` : ""
                      } at ${formatTime(marker.relativeTime / 1000)}`}
                      onClick={() => handleSeek(marker.relativeTime)}
                    >
                      <span className="event-marker-symbol">
                        {marker.typeInfo.symbol}
                      </span>
                      {marker.grouped && (
                        <span className="event-marker-count">
                          {marker.count}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Draggable timeline scrubber */}
                {!isTrimmingMode && (
                  <div
                    className="timeline-scrubber"
                    style={{ left: `${(currentTime / duration) * 100}%` }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const startX = e.clientX;
                      const startTime = currentTime;
                      const parentEl = e.currentTarget.parentElement;
                      if (!parentEl) return;
                      const rect = parentEl.getBoundingClientRect();

                      const handleMouseMove = (e: MouseEvent) => {
                        const deltaX = e.clientX - startX;
                        const deltaPercent = deltaX / rect.width;
                        const newTime = Math.max(
                          0,
                          Math.min(
                            duration,
                            startTime + deltaPercent * duration
                          )
                        );
                        handleSeek(newTime);
                      };

                      const handleMouseUp = () => {
                        document.removeEventListener(
                          "mousemove",
                          handleMouseMove
                        );
                        document.removeEventListener("mouseup", handleMouseUp);
                      };

                      document.addEventListener("mousemove", handleMouseMove);
                      document.addEventListener("mouseup", handleMouseUp);
                    }}
                  />
                )}

                {isTrimmingMode && (
                  <>
                    <div
                      className="trim-overlay trim-start"
                      style={{ width: `${(trimStart / duration) * 100}%` }}
                    />
                    <div
                      className="trim-overlay trim-end"
                      style={{
                        left: `${(trimEnd / duration) * 100}%`,
                        width: `${((duration - trimEnd) / duration) * 100}%`,
                      }}
                    />
                    <div
                      className="trim-handle trim-handle-start"
                      style={{ left: `${(trimStart / duration) * 100}%` }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const startX = e.clientX;
                        const startValue = trimStart;
                        const parentEl = e.currentTarget.parentElement;
                        if (!parentEl) return;
                        const rect = parentEl.getBoundingClientRect();

                        const handleMouseMove = (e: MouseEvent) => {
                          const deltaX = e.clientX - startX;
                          const deltaPercent = deltaX / rect.width;
                          const newValue = startValue + deltaPercent * duration;
                          handleTrimHandleChange("start", newValue);
                        };

                        const handleMouseUp = () => {
                          document.removeEventListener(
                            "mousemove",
                            handleMouseMove
                          );
                          document.removeEventListener(
                            "mouseup",
                            handleMouseUp
                          );
                        };

                        document.addEventListener("mousemove", handleMouseMove);
                        document.addEventListener("mouseup", handleMouseUp);
                      }}
                    />
                    <div
                      className="trim-handle trim-handle-end"
                      style={{ left: `${(trimEnd / duration) * 100}%` }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const startX = e.clientX;
                        const startValue = trimEnd;
                        const parentEl = e.currentTarget.parentElement;
                        if (!parentEl) return;
                        const rect = parentEl.getBoundingClientRect();

                        const handleMouseMove = (e: MouseEvent) => {
                          const deltaX = e.clientX - startX;
                          const deltaPercent = deltaX / rect.width;
                          const newValue = startValue + deltaPercent * duration;
                          handleTrimHandleChange("end", newValue);
                        };

                        const handleMouseUp = () => {
                          document.removeEventListener(
                            "mousemove",
                            handleMouseMove
                          );
                          document.removeEventListener(
                            "mouseup",
                            handleMouseUp
                          );
                        };

                        document.addEventListener("mousemove", handleMouseMove);
                        document.addEventListener("mouseup", handleMouseUp);
                      }}
                    />
                  </>
                )}
              </div>

              <div className="timeline-times">
                <span>{formatTime(currentTime / 1000)}</span>
                {isTrimmingMode && (
                  <span className="trim-info">
                    Trim: {formatTime(trimStart / 1000)} -{" "}
                    {formatTime(trimEnd / 1000)}
                  </span>
                )}
                <span>{formatTime(duration / 1000)}</span>
              </div>
            </div>

            <div className="player-controls">
              <button onClick={handlePlay} disabled={isPlaying}>
                ▶️ Play
              </button>
              <button onClick={handlePause} disabled={!isPlaying}>
                ⏸️ Pause
              </button>
              <button onClick={handleStop}>⏹️ Stop</button>

              {!isTrimmingMode ? (
                <button onClick={handleStartTrimming} className="trim-button">
                  ✂️ Trim
                </button>
              ) : (
                <>
                  <button onClick={handleSaveTrim} className="save-trim-button">
                    💾 Save Trim
                  </button>
                  <button
                    onClick={handleCancelTrim}
                    className="cancel-trim-button"
                  >
                    ❌ Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {events && (
        <div className="tools-section">
          <div className="tool-card">
            <h3>Cut Recording</h3>
            <p>Create a clip from a specific point in the recording.</p>
            <div className="form-group">
              <label htmlFor="cut-timestamp">Timestamp to cut around:</label>
              <input
                id="cut-timestamp"
                type="text"
                value={cutTimestamp}
                onChange={(e) => setCutTimestamp(e.target.value)}
                placeholder="e.g., 1m2s, 30s, 1:20"
              />
            </div>
            <div className="form-group-inline">
              <div className="form-group">
                <label htmlFor="before-seconds">Seconds before:</label>
                <input
                  id="before-seconds"
                  type="number"
                  value={beforeSeconds}
                  onChange={(e) => setBeforeSeconds(Number(e.target.value))}
                />
              </div>
              <div className="form-group">
                <label htmlFor="after-seconds">Seconds after:</label>
                <input
                  id="after-seconds"
                  type="number"
                  value={afterSeconds}
                  onChange={(e) => setAfterSeconds(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="button-group">
              <button
                className="button-primary"
                onClick={() => handleCut("load")}
              >
                Load as New Recording
              </button>
              <button onClick={() => handleCut("download")}>
                Download Clip
              </button>
            </div>
          </div>
        </div>
      )}

      {snackbar && (
        <Snackbar
          message={snackbar.message}
          type={snackbar.type}
          onClose={() => setSnackbar(null)}
        />
      )}
    </div>
  );
}

export default App;
