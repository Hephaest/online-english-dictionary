import { Action, ActionPanel, Detail, Keyboard } from "@raycast/api";
import type { Entry, Picture } from "../model/entry";
import { escapeMarkdown } from "../model/markdown";

/** Owner-set constant: width of the picture on its own page. */
const FULL_PICTURE_WIDTH = 640;

interface PictureDetailProps {
  entry: Entry;
  picture: Picture;
}

export function PictureDetail({ entry, picture }: PictureDetailProps) {
  const url = picture.fullUrl ?? picture.thumbUrl;
  const separator = url.includes("?") ? "&" : "?";
  const lines = [
    `# ${escapeMarkdown(entry.headword)}`,
    "",
    `![${escapeMarkdown(picture.caption ?? entry.headword)}](${url}${separator}raycast-width=${FULL_PICTURE_WIDTH})`,
  ];
  if (picture.caption) lines.push("", `*${escapeMarkdown(picture.caption)}*`);
  if (picture.credit) lines.push("", `*Photo: ${escapeMarkdown(picture.credit)}*`);
  return (
    <Detail
      navigationTitle={`${entry.headword} picture`}
      markdown={lines.join("\n")}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser title="Open Picture in Browser" url={url} shortcut={Keyboard.Shortcut.Common.Open} />
          <Action.CopyToClipboard title="Copy Picture URL" content={url} shortcut={Keyboard.Shortcut.Common.Copy} />
        </ActionPanel>
      }
    />
  );
}
