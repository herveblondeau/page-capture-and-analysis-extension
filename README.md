# Page Capture & Analysis

A Chrome extension that captures content from web pages and sends it to an analysis API. It is designed to be used together with the API provided by the [Workflow](https://github.com/herveblondeau/Workflow) project.

## Features

The extension supports five capture modes:

- **Text** — captures the selected text on the current page
- **Image** — lets you draw a region on the screen and captures it as a screenshot
- **URL** — captures the current page URL
- **Page** — captures the full text content of the current page
- **Clipboard** — reads the current clipboard content

After capturing, you can optionally add instructions to guide the analysis, then send everything to the configured API endpoint. Results are displayed inline with Markdown rendering.

## Setup

1. Load the extension in Chrome via `chrome://extensions` → **Load unpacked**, and select this directory.
2. Open the extension **Settings** page and configure the fields below.

### Settings

| Setting                        | Description                                                                                                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Analysis endpoint base URL** | Base URL of your [Workflow](https://github.com/herveblondeau/Workflow) API instance, up to and including `/api` (e.g. `http://localhost:5261/api`).                                                                                                  |
| **API key**                    | Sent as the `X-Api-Key` header with every request (set up in your [Workflow](https://github.com/herveblondeau/Workflow) API instance). Leave blank if not required.                                                                                  |
| **Provider and model**         | **After** setting the analysis endpoint base URL and the API, key, click **Refresh** to fetch the list of available providers and models from the API, then select the provider and model to use for analysis. The selection is saved automatically. |

## API endpoints

The extension communicates with the following routes on the configured base URL:

| Capture mode          | Method | Route             | Format                |
| --------------------- | ------ | ----------------- | --------------------- |
| Text, Page, Clipboard | POST   | `/analysis/text`  | JSON                  |
| URL                   | POST   | `/analysis/url`   | JSON                  |
| Image                 | POST   | `/analysis/image` | `multipart/form-data` |
| Model list (Settings) | GET    | `/system/models`  | —                     |

## Usage

1. Click the extension icon to open the popup.
2. Select a capture mode using the mode buttons at the top.
3. Optionally type instructions to guide the analysis before clicking **Analyze**.
4. Click **Capture** (image mode) or go straight to **Analyze** (all other modes capture automatically).
5. The result appears in the **Result** section and can be copied or viewed in a full-page overlay.
