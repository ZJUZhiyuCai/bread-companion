import type { SavedCase } from '@/domain/types';
import { downloadArchive } from '@/services/export';

// Use the shared validated exporter, including inert Markdown for user-provided text.
export function downloadSavedCase(saved: SavedCase, format: 'md' | 'json') {
  downloadArchive(saved, format);
}
