const fs = require("fs/promises");
const path = require("path");
const { JSDOM } = require("jsdom");
const { Replayer, snapshot } = require("rrweb");

const EventType = {
  FullSnapshot: 2,
};

async function createSyntheticSnapshot(events, targetTimestamp) {
  return new Promise(async (resolve, reject) => {
    let replayer = null;
    const g = global;

    try {
      const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
        url: "http://localhost",
        runScripts: "dangerously",
        pretendToBeVisual: true,
      });

      g.window = dom.window;
      g.document = dom.window.document;
      g.Node = dom.window.Node;
      g.Element = dom.window.Element;
      g.HTMLElement = dom.window.HTMLElement;
      g.SVGElement = dom.window.SVGElement;
      g.Event = dom.window.Event;
      g.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      g.cancelAnimationFrame = (id) => clearTimeout(id);

      const container = dom.window.document.body;
      const startTime = events[0]?.timestamp;
      if (!startTime) throw new Error("No start time in events.");
      const relativeTarget = targetTimestamp - startTime;

      replayer = new Replayer(events, {
        root: container,
        skipInactive: true,
        showWarning: false,
        speed: Infinity,
        mouseTail: false,
        useVirtualDom: false,
      });

      replayer.play(relativeTarget);
      await new Promise((r) => setTimeout(r, 300));
      replayer.pause();

      const iframe = container.querySelector("iframe");
      if (!iframe || !iframe.contentDocument) {
        throw new Error("Could not find replayer iframe.");
      }

      const snapshotNode = snapshot(iframe.contentDocument, {
        mirror: replayer.getMirror(),
      });

      if (!snapshotNode) throw new Error("Failed to take snapshot.");

      resolve({
        type: EventType.FullSnapshot,
        data: {
          node: snapshotNode,
          initialOffset: { left: 0, top: 0 },
        },
        timestamp: targetTimestamp,
      });
    } catch (error) {
      reject(error);
    } finally {
      replayer?.destroy();
      g.window?.close();
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: node scripts/generate-snapshot.js <input> <output> [timestamp]"
    );
    process.exit(1);
  }

  const [inputPath, outputPath, timestampStr] = args;
  const inputFile = path.resolve(inputPath);
  const outputFile = path.resolve(outputPath);

  console.log(`Input file: ${inputFile}`);
  console.log(`Output file: ${outputFile}`);

  try {
    const recordingJSON = await fs.readFile(inputFile, "utf-8");
    const events = JSON.parse(recordingJSON);

    if (!Array.isArray(events) || events.length === 0) {
      throw new Error("Input file has no events.");
    }

    const targetTimestamp = timestampStr
      ? parseFloat(timestampStr)
      : events[events.length - 1].timestamp;

    if (isNaN(targetTimestamp)) {
      throw new Error("Invalid timestamp.");
    }

    console.log(`Target timestamp: ${targetTimestamp}`);
    console.log(`Generating snapshot...`);

    const snapshotEvent = await createSyntheticSnapshot(
      events,
      targetTimestamp
    );
    await fs.writeFile(outputFile, JSON.stringify(snapshotEvent, null, 2));
    console.log(`\n✅ Snapshot saved to:\n${outputFile}`);
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

main();
