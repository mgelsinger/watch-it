-- Preserve the language needed for Korean drama and anime library filters.
-- Existing titles are populated by the next metadata sync.
ALTER TABLE titles ADD COLUMN original_language TEXT;
