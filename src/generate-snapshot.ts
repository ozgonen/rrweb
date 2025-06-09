import fs from "fs/promises";
import path from "path";
import { JSDOM } from "jsdom";
import { Replayer } from "rrweb";
import { snapshot } from "rrweb-snapshot";
import {
  RRWebEvent,
  EventType,
  FullSnapshotEvent,
  SnapshotOptions,
} from "./types/rrweb";

// Minimal Replayer config for Node.js
interface ReplayerConfig {
  root: HTMLElement;
  skipInactive?: boolean;
  showWarning?: boolean;
  showDebug?: boolean;
  blockClass?: string;
  maskTextClass?: string;
  speed?: number;
  mouseTail?: boolean;
  triggerFocus?: boolean;
  UNSAFE_replayCanvas?: boolean;
  useVirtualDom?: boolean;
  plugins?: any[];
}

/**
 * Helper function to wait for pause to complete.
 * @param replayer - The rrweb replayer instance.
 * @returns A promise that resolves when the replayer is paused.
 */
const pauseAndWait = (replayer: Replayer): Promise<void> => {
  return new Promise((resolve, reject) => {
    try {
      replayer.pause();
      // Allow time for the DOM to stabilize after pausing
      setTimeout(() => resolve(), 300);
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Creates a synthetic full snapshot by replaying events to a target timestamp.
 * This function is adapted to run in a Node.js environment using JSDOM.
 * @param events - The array of rrweb events.
 * @param targetTimestamp - The timestamp to create the snapshot at.
 * @returns A promise that resolves with the full snapshot event.
 */
async function createSyntheticSnapshot(
  events: RRWebEvent[],
  targetTimestamp: number
): Promise<FullSnapshotEvent> {
  return new Promise(async (resolve, reject) => {
    let replayer: Replayer | null = null;
    let dom: JSDOM | null = null;

    try {
      // Set up JSDOM environment
      dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
        url: "http://localhost",
        runScripts: "dangerously",
        pretendToBeVisual: true,
      });

      // Assign globals for rrweb to use
      (global as any).window = dom.window;
      (global as any).document = dom.window.document;
      (global as any).Node = dom.window.Node;
      (global as any).Element = dom.window.Element;
      (global as any).HTMLElement = dom.window.HTMLElement;
      (global as any).SVGElement = dom.window.SVGElement;
      (global as any).Event = dom.window.Event;
      (global as any).requestAnimationFrame = (callback: FrameRequestCallback) =>
        setTimeout(() => callback(Date.now()), 16);
      (global as any).cancelAnimationFrame = (id: number) => clearTimeout(id);

      const container = dom.window.document.body;
      const startTime = events[0]?.timestamp;
      if (!startTime) {
        throw new Error("Cannot determine start time from events.");
      }
      const relativeTarget = targetTimestamp - startTime;

      // Replayer configuration for Node.js
      const replayerConfig: ReplayerConfig = {
        root: container,
        skipInactive: true,
        showWarning: false,
        speed: Infinity,
        mouseTail: false,
        useVirtualDom: false,
      };

      replayer = new Replayer(events, replayerConfig);

      // Play to the target time
      replayer.play(relativeTarget);
      await pauseAndWait(replayer);

      const iframe = container.querySelector("iframe");
      if (!iframe || !iframe.contentDocument) {
        throw new Error("Could not find replayer iframe content document.");
      }

      // Snapshot the state of the iframe
      const snapshotOptions: SnapshotOptions = {
        blockClass: "rr-block",
        maskTextClass: "rr-mask",
        ignoreClass: "rr-ignore",
        inlineStylesheet: true,
        maskAllInputs: true,
        preserveWhiteSpace: true,
        mirror: replayer.getMirror(),
      };

      const snapshotNode = snapshot(iframe.contentDocument, snapshotOptions);
      if (!snapshotNode) {
        throw new Error("Failed to take snapshot.");
      }

      // Create the full snapshot event
      const snapshotEvent: FullSnapshotEvent = {
        type: EventType.FullSnapshot,
        data: {
          node: snapshotNode,
          initialOffset: {
            left: 0,
            top: 0,
          },
        },
        timestamp: targetTimestamp,
      };

      resolve(snapshotEvent);
    } catch (error) {
      reject(error);
    } finally {
      // Cleanup
      if (replayer) {
        replayer.destroy();
      }
      if ((global as any).window) {
        (global as any).window.close();
      }
    }
  });
}

/**
 * Main function to run the snapshot generator script.
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: npm run generate-snapshot -- <input.json> <output.json> [timestamp]"
    );
    process.exit(1);
  }

  const [inputPath, outputPath, timestampStr] = args;
  const inputFile = path.resolve(inputPath);
  const outputFile = path.resolve(outputPath);

  try {
    // Read and parse the recording file
    const recordingJSON = await fs.readFile(inputFile, "utf-8");
    const events: RRWebEvent[] = JSON.parse(recordingJSON);

    if (!Array.isArray(events) || events.length === 0) {
      throw new Error("Input file does not contain a valid events array.");
    }

    // Determine the target timestamp
    let targetTimestamp: number;
    if (timestampStr) {
      const parsedTime = parseInt(timestampStr, 10);
      if (isNaN(parsedTime)) {
        throw new Error("Invalid timestamp provided. Must be a number.");
      }
      targetTimestamp = parsedTime;
    } else {
      // Default to the timestamp of the last event
      targetTimestamp = events[events.length - 1].timestamp;
    }

    console.log(`Generating snapshot for timestamp: ${targetTimestamp}...`);

    // Create the snapshot
    const snapshotEvent = await createSyntheticSnapshot(events, targetTimestamp);

    // Write the snapshot to the output file
    await fs.writeFile(outputFile, JSON.stringify(snapshotEvent, null, 2));

    console.log(`\nSnapshot successfully generated and saved to:`);
    console.log(outputFile);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("\nError generating snapshot:", errorMessage);
    process.exit(1);
  }
}

main(); 