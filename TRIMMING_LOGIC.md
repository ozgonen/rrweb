# rrweb Recording Trimming Logic

## Overview

The trimming functionality in the rrweb player allows users to extract a specific time range from a larger recording. This is particularly useful for:
- Creating clips of specific user interactions
- Reducing file sizes by removing unnecessary portions
- Focusing on problematic areas for debugging
- Sharing concise recordings of specific issues

## The Challenge

rrweb recordings consist of a series of events that capture DOM changes over time. The main challenge in trimming is that rrweb uses an event-based system where:

1. **Full Snapshots** (type 2): Complete DOM state at a specific moment
2. **Incremental Snapshots** (type 3): Changes (mutations) to the DOM since the last snapshot
3. **Meta Events** (type 4): Metadata like page URL, viewport size
4. **Other Events**: Mouse movements, interactions, etc.

Simply cutting events at arbitrary timestamps would break the recording because incremental changes depend on having a valid base state (full snapshot) to apply mutations to.

## Core Concepts

### 1. Event Dependencies

```
Time:     0ms    500ms   1000ms  1500ms  2000ms  2500ms
Events:   [FS]---[IC]----[IC]----[IC]----[FS]----[IC]
          Full   Incr.   Incr.   Incr.   Full    Incr.
          Snap   Change  Change  Change  Snap    Change
```

If we want to trim from 800ms to 1800ms, we can't just take events in that range because:
- The incremental changes at 1000ms and 1500ms depend on the full snapshot at 0ms
- Without the base state, the changes can't be applied

### 2. True Synthetic Full Snapshot

The solution is to create a **true synthetic full snapshot** at the trim start point that represents the complete DOM state at that moment. This involves:

1. Replaying the entire recording up to the trim start point in a hidden container
2. Using rrweb's `Replayer` to reconstruct the exact DOM state
3. Taking a snapshot of the live DOM using `rrweb-snapshot`
4. Creating a new full snapshot event with this captured state

## Implementation Details

### The `trimRecording` Function

```javascript
export async function trimRecording(events, startMs, endMs)
```

This function handles the entire trimming process and is now **asynchronous** due to the synthetic snapshot creation:

#### 1. **Validation Phase**
```javascript
// Validate input
if (!events || !Array.isArray(events) || events.length === 0) {
  throw new Error("Invalid events array provided");
}

// Validate time range
const recordingStart = events[0].timestamp;
const recordingEnd = events[events.length - 1].timestamp;

if (startMs < recordingStart) {
  startMs = recordingStart; // Adjust to recording bounds
}

if (endMs > recordingEnd) {
  endMs = recordingEnd; // Adjust to recording bounds
}

if (startMs >= endMs) {
  throw new Error("Invalid time range");
}
```

#### 2. **True Synthetic Snapshot Creation**
```javascript
const syntheticSnapshot = await createTrueSyntheticSnapshot(events, startMs);
```

This creates a perfect full snapshot by actually replaying the recording to the exact trim point.

#### 3. **Building the Trimmed Recording**
The new approach creates a clean, minimal recording:

```javascript
const newEvents = [];

// Create meta event at timestamp 0
const metaEvent = {
  type: 4, // Meta
  data: {
    href: originalMeta?.data?.href || window.location.href,
    width: originalMeta?.data?.width || 1920,
    height: originalMeta?.data?.height || 1080,
  },
  timestamp: 0,
};
newEvents.push(metaEvent);

// Add synthetic snapshot at timestamp 1
const adjustedSnapshot = {
  ...syntheticSnapshot,
  timestamp: 1,
};
newEvents.push(adjustedSnapshot);

// Include only events within the trim range, adjusting timestamps
const eventsInRange = events.filter((event) => {
  return event.timestamp > startMs && event.timestamp <= endMs;
});

// Add all events in range with adjusted timestamps
for (const event of eventsInRange) {
  const adjustedEvent = {
    ...event,
    timestamp: event.timestamp - startMs + 2, // Start after meta and snapshot
  };
  newEvents.push(adjustedEvent);
}
```

#### 4. **Fallback Mechanism**
If synthetic snapshot creation fails, the system automatically falls back to the traditional method:

```javascript
try {
  const syntheticSnapshot = await createTrueSyntheticSnapshot(events, startMs);
  // ... use synthetic snapshot
} catch (error) {
  console.error("Failed to create synthetic snapshot:", error);
  console.log("Falling back to traditional trim method...");
  return trimRecordingFallback(events, startMs, endMs);
}
```

### The `createTrueSyntheticSnapshot` Function

```javascript
async function createTrueSyntheticSnapshot(events, targetTimestamp)
```

This is the core innovation that creates perfect snapshots:

#### 1. **Hidden Container Setup**
```javascript
// Create a hidden container for replay
container = document.createElement("div");
container.style.position = "fixed";
container.style.top = "-9999px";
container.style.left = "-9999px";
container.style.width = "1920px";
container.style.height = "1080px";
container.style.overflow = "hidden";
container.style.visibility = "hidden";
document.body.appendChild(container);
```

#### 2. **Replayer Initialization**
```javascript
// Create replayer with synchronous rendering
replayer = new Replayer(events, {
  root: container,
  skipInactive: false,
  showWarning: false,
  showDebug: false,
  blockClass: "rr-block",
  maskTextClass: "rr-mask",
  speed: 1,
  mouseTail: false,
  triggerFocus: false,
  UNSAFE_replayCanvas: false,
  useVirtualDom: false,
  plugins: [],
});
```

#### 3. **Precise Timing Control**
```javascript
// Calculate relative time from recording start
const startTime = events[0].timestamp;
const relativeTarget = targetTimestamp - startTime;

// Play to exact target time
replayer.play(relativeTarget);

// Wait for playback to reach target with precision timing
await new Promise((resolve, reject) => {
  let attempts = 0;
  const maxAttempts = 1000; // 10 seconds max

  const checkInterval = setInterval(() => {
    attempts++;
    const currentTime = replayer.getCurrentTime();

    if (currentTime >= relativeTarget - 10) {
      clearInterval(checkInterval);
      resolve();
    } else if (attempts >= maxAttempts) {
      clearInterval(checkInterval);
      reject(new Error(`Timeout waiting for playback`));
    }
  }, 10);
});
```

#### 4. **DOM Snapshot Capture**
```javascript
// Pause and wait for DOM to stabilize
await pauseAndWait(replayer, relativeTarget);

// Get the iframe containing the replayed content
const iframe = container.querySelector("iframe");
if (!iframe || !iframe.contentDocument) {
  throw new Error("Could not access replay iframe");
}

// Take the snapshot using rrweb-snapshot
const domSnapshot = snapshot(iframe.contentDocument, {
  blockClass: "rr-block",
  maskTextClass: "rr-mask",
  ignoreClass: "rr-ignore",
  inlineStylesheet: true,
  maskAllInputs: false,
  preserveWhiteSpace: true,
  mirror: replayer.getMirror(),
});
```

#### 5. **Synthetic Event Creation**
```javascript
// Create the synthetic full snapshot event
const syntheticSnapshot = {
  type: 2, // FullSnapshot
  data: {
    node: domSnapshot,
    initialOffset: {
      left: 0,
      top: 0,
    },
  },
  timestamp: targetTimestamp,
};

// Add tabId if present in original events
if (tabId !== undefined) {
  syntheticSnapshot.tabId = tabId;
}
```

### Current Behavior: Perfect Trimming

The current implementation achieves **perfect trimming** with these characteristics:

**How It Works:**
1. **True DOM Replay**: The entire recording is replayed in a hidden container up to the exact trim start time
2. **Perfect State Capture**: A snapshot is taken of the actual DOM at the precise moment
3. **Clean Timeline**: The trimmed recording starts at timestamp 0 with perfect state
4. **Zero Dependencies**: No pre-trim events are needed since the snapshot is complete

**What This Means:**
- When you trim from 1:05 to 1:16:
  - The system replays the recording up to exactly 1:05 in the background
  - A perfect snapshot captures the DOM state at 1:05
  - The trimmed recording contains meta (t=0), snapshot (t=1), then only events from 1:05 to 1:16
- **No buildup time**: Playback starts immediately with the correct state
- **No pre-trim events**: Only events within the trim range are included
- **Perfect fidelity**: The DOM state is exactly as it was at the trim start

**Performance Characteristics:**
- **CPU Intensive**: Must replay the entire recording to the trim point
- **Memory Efficient**: Final output only contains necessary events
- **Time Complexity**: O(n) where n is events before trim point
- **Space Complexity**: O(m) where m is events within trim range

**Browser Requirements:**
- Must run in a browser environment (DOM manipulation required)
- Requires iframe access (same-origin policy compliance)
- Memory proportional to recording complexity

## Utility Functions

### Helper Functions Available

```javascript
// Convert timestamps to relative time
export function timestampToRelativeTime(events, timestamp)

// Format seconds as MM:SS or HH:MM:SS
export function formatTime(seconds)

// Parse time strings to seconds
export function parseTimeString(timeStr)

// Cut recording around a center point (different from trim)
export function cutRecording(events, centerTimeSeconds, beforeSeconds, afterSeconds)

// Find events containing specific content
export function findEventsByContent(events, searchTerm)

// Analyze recording statistics
export function analyzeRecording(events)
```

### The `cutRecording` vs `trimRecording` Distinction

- **`cutRecording`**: Creates a clip centered around a specific time with padding before/after
- **`trimRecording`**: Extracts a precise time range from start to end

## Usage Examples

### Basic Trimming
```javascript
// Load a recording
const events = JSON.parse(recordingData);

// Trim from 5 seconds to 15 seconds (absolute timestamps)
const recordingStart = events[0].timestamp;
const startMs = recordingStart + 5000;  // 5 seconds from start
const endMs = recordingStart + 15000;   // 15 seconds from start

try {
  // trimRecording is async and creates perfect snapshots
  const trimmedEvents = await trimRecording(events, startMs, endMs);
  
  // Save or play the trimmed recording
  const trimmedRecording = JSON.stringify(trimmedEvents);
  
} catch (error) {
  console.error('Trimming failed:', error.message);
  // System automatically falls back to traditional method
}
```

### Using Relative Times
```javascript
// Parse user input like "1:05" to "1:16"
const startSeconds = parseTimeString("1:05"); // 65 seconds
const endSeconds = parseTimeString("1:16");   // 76 seconds

const recordingStart = events[0].timestamp;
const startMs = recordingStart + startSeconds * 1000;
const endMs = recordingStart + endSeconds * 1000;

const trimmedEvents = await trimRecording(events, startMs, endMs);
```

### Creating Clips Around Events
```javascript
// Find when user clicked on something specific
const clickEvents = findEventsByContent(events, '"click"');
if (clickEvents.length > 0) {
  const clickTime = timestampToRelativeTime(events, clickEvents[0].timestamp);
  
  // Create 10-second clip (5 seconds before, 5 after)
  const clip = cutRecording(events, clickTime, 5, 5);
}
```

## Error Handling & Troubleshooting

### Common Errors and Solutions

#### Synthetic Snapshot Creation Failures
```
Error: "Could not find replay iframe"
Solution: Ensure running in browser, check for DOM security restrictions

Error: "Could not access iframe content document"  
Solution: Check same-origin policy, ensure no cross-domain restrictions

Error: "Timeout waiting for playback to reach target"
Solution: Recording may be too complex; will auto-fallback to traditional method
```

#### Input Validation Errors
```
Error: "Invalid events array provided"
Solution: Ensure events is a non-empty array

Error: "Invalid time range: start time must be before end time"
Solution: Check that startMs < endMs

Error: "No full snapshot found in recording"
Solution: Recording may be corrupted; ensure it contains type 2 events
```

### Fallback Behavior

When synthetic snapshot creation fails, the system automatically uses `trimRecordingFallback`:

1. **Finds Best Snapshot**: Locates the closest full snapshot before trim start
2. **Includes Necessary Mutations**: Adds minimal DOM changes needed for correct state
3. **Time Compression**: Compresses pre-trim events into first 100ms for efficiency
4. **Maintains Compatibility**: Ensures resulting recording works with standard rrweb player

## Performance Considerations

### Memory Usage
- **Peak Memory**: During synthetic snapshot creation (temporary)
- **Final Size**: Only includes events within trim range
- **Optimization**: Large recordings benefit most from perfect trimming

### CPU Usage
- **Intensive Phase**: Replaying to trim point (one-time cost)
- **Efficient Output**: Minimal events in final recording
- **Async Nature**: Won't block UI during processing

### Best Practices
1. **Trim Early**: Process recordings as soon as possible after capture
2. **Batch Processing**: For multiple clips, consider processing in sequence
3. **Progress Feedback**: Inform users that synthetic snapshot creation takes time
4. **Error Handling**: Always handle both synthetic and fallback methods

## Visual Timeline Examples

### Original Recording
```
0s          5s          10s         15s         20s
|-----------|-----------|-----------|-----------|
[FS]  [IC] [IC] [IC]  [FS]  [IC] [IC]  [IC]  [FS]
      User clicks      Page loads   Mouse moves
```

### Perfect Trimming (3s to 12s)
```
Background Process:
0s → 3s: [Replay entire recording in hidden container]
3s: [Perfect DOM snapshot captured]

Final Output:
0ms        1ms                    9s (relative)
|          |                     |
[Meta] [Perfect Snapshot] [IC] [FS] [IC] [IC]
```

**Key Benefits:**
- Output starts at 0ms with perfect state at 3s
- No buildup or loading time
- Exact DOM state preservation
- Minimal file size (only trim range events)

### Traditional Fallback (when synthetic fails)
```
0s          3s                   12s
|-----------|-------------------|
[FS] [compressed mutations] [events in range]
```

## Advanced Features

### Recording Analysis
```javascript
const stats = analyzeRecording(events);
console.log(`Duration: ${formatTime(stats.duration)}`);
console.log(`Total Events: ${stats.totalEvents}`);
console.log(`Event Types:`, stats.eventTypeCounts);
```

### Content-Based Trimming
```javascript
// Find all form submissions
const formEvents = findEventsByContent(events, 'submit');

// Create clips around each form submission
for (const event of formEvents) {
  const eventTime = timestampToRelativeTime(events, event.timestamp);
  const clip = cutRecording(events, eventTime, 10, 5); // 10s before, 5s after
  
  // Save individual clips
  saveClip(`form_submission_${eventTime}.json`, clip);
}
```

## Future Enhancements

### Planned Improvements
1. **Streaming Processing**: Handle recordings too large for memory
2. **Worker Thread Support**: Move synthetic snapshot creation off main thread  
3. **Progress Callbacks**: Real-time progress updates during processing
4. **Batch Trimming**: Efficiently create multiple clips from one recording
5. **Smart Caching**: Reuse snapshots for overlapping trim ranges

### Advanced Use Cases
1. **Multi-Range Trimming**: Extract multiple non-contiguous ranges
2. **Conditional Trimming**: Trim based on event content analysis
3. **Quality Optimization**: Remove redundant events during trimming
4. **Format Conversion**: Export to different formats during trim process

## Conclusion

The current trimming implementation represents a significant advancement in rrweb recording manipulation. By creating true synthetic snapshots through actual DOM replay, we achieve:

- **Perfect Fidelity**: Exact DOM state at any timestamp
- **Clean Output**: No dependency on pre-trim events  
- **Optimal Size**: Minimal file sizes with maximum accuracy
- **Robust Fallback**: Graceful degradation when advanced features fail

This approach makes trimmed recordings completely self-contained and ensures they play back exactly as the original recording would at the trimmed timepoint, making it ideal for debugging, documentation, and sharing specific user interactions. 