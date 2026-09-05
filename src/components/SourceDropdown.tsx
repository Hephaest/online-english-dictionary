import { List } from "@raycast/api";
import type { SourceId } from "../model/entry";
import type { DictionarySource } from "../sources/types";

interface SourceDropdownProps {
  sources: DictionarySource[];
  value: SourceId;
  onChange: (id: SourceId) => void;
}

export function SourceDropdown({ sources, value, onChange }: SourceDropdownProps) {
  return (
    <List.Dropdown
      tooltip="Dictionary"
      value={value}
      onChange={(next) => onChange(next as SourceId)}
      storeValue={false}
    >
      {sources.map((source) => (
        <List.Dropdown.Item key={source.id} title={source.title} value={source.id} />
      ))}
    </List.Dropdown>
  );
}
