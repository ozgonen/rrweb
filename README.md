# rrweb Player App

A React application for playing back rrweb session recordings from local JSON files.

## Features

- 🎮 **Interactive Player**: Full playback controls (play, pause, reset)
- 📁 **Drag & Drop**: Easy file upload with drag and drop support
- 🎨 **Modern UI**: Beautiful, responsive design with glass-morphism effects
- ⚡ **Real-time Preview**: Instant playback of uploaded recordings
- 🔧 **Built-in Controls**: Speed control, timeline scrubbing, and more

## Getting Started

### Prerequisites

- Node.js (version 14 or higher)
- npm or yarn

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm start
   ```

3. Open [http://localhost:3000](http://localhost:3000) to view the app in your browser.

### Usage

1. **Upload a Recording**: 
   - Click the upload area or drag and drop a JSON file containing rrweb events
   - The file should contain an array of rrweb event objects

2. **Control Playback**:
   - Use the Play/Pause buttons to control playback
   - Reset button returns to the beginning
   - Built-in player controls allow speed adjustment and timeline scrubbing

3. **Sample File**:
   - A sample events file is available at `public/sample-events.json` for testing

## File Format

The app expects JSON files containing rrweb events in the following format:

```json
[
  {
    "type": 4,
    "data": {
      "href": "https://example.com",
      "width": 1200,
      "height": 800
    },
    "timestamp": 1640995200000
  },
  {
    "type": 2,
    "data": {
      "node": {
        // DOM snapshot data
      }
    },
    "timestamp": 1640995200100
  }
  // ... more events
]
```

## Technology Stack

- **React 18**: Modern React with hooks
- **rrweb-player**: Official rrweb player component
- **CSS3**: Modern styling with backdrop-filter and gradients

## Available Scripts

- `npm start`: Run the app in development mode
- `npm build`: Build the app for production
- `npm test`: Run the test suite
- `npm eject`: Eject from Create React App (one-way operation)

## Contributing

Feel free to submit issues and enhancement requests!

## License

This project is open source and available under the [MIT License](LICENSE). 