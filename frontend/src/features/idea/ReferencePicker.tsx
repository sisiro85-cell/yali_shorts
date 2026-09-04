import { useRef, useState, type ChangeEvent } from "react";
import { Folder, Plus } from "@phosphor-icons/react";
import type { IdeaReferenceAsset } from "../../app/api";
import { HelpTooltip } from "./HelpTooltip";

export function ReferencePicker({
  assets,
  selectedIds,
  onChange,
  onAdd,
  error,
}: {
  assets: IdeaReferenceAsset[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  onAdd: (file: File) => Promise<void>;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  function toggle(assetId: string) {
    onChange(selectedIds.includes(assetId) ? selectedIds.filter((id) => id !== assetId) : [...selectedIds, assetId]);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setIsUploading(true);
    setUploadError("");
    try {
      await onAdd(file);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "자료를 등록하지 못했습니다.");
    } finally {
      setIsUploading(false);
    }
  }

  function addButton() {
    return <button className="button button--secondary idea-reference__add" type="button" onClick={() => inputRef.current?.click()} disabled={isUploading}>
      {isUploading ? "등록 중…" : "자료 추가"} <Plus size={16} aria-hidden="true" />
    </button>;
  }

  return (
    <section className="idea-reference" aria-labelledby="idea-reference-title" aria-describedby={error ? "idea-reference-error" : undefined} aria-invalid={Boolean(error)}>
      <div className="idea-field__heading">
        <h2 id="idea-reference-title">참고 자료</h2>
        <HelpTooltip label="참고 자료 도움말" description="새 앱의 라이브러리에 등록된 자료만 사용할 수 있습니다." />
      </div>
      {assets.length === 0 ? (
        <div className="idea-reference__empty">
          <Folder size={28} weight="regular" aria-hidden="true" />
          <strong>아직 추가된 자료가 없습니다.</strong>
          <span>새 앱 라이브러리에 등록하면 더 정확한 아이디어를 얻을 수 있어요.</span>
          <input ref={inputRef} className="sr-only" type="file" accept="image/*,video/*,audio/*,.txt,.pdf" onChange={handleFileChange} aria-label="참고 자료 파일" />
          {addButton()}
          {uploadError ? <p className="idea-field__error" role="alert">{uploadError}</p> : null}
        </div>
      ) : (
        <>
          <input ref={inputRef} className="sr-only" type="file" accept="image/*,video/*,audio/*,.txt,.pdf" onChange={handleFileChange} aria-label="참고 자료 파일" />
          {addButton()}
          {uploadError ? <p className="idea-field__error" role="alert">{uploadError}</p> : null}
          <div className="idea-reference__list" aria-label="등록된 참고 자료">
            {assets.map((asset) => {
              const selected = selectedIds.includes(asset.id);
              return (
                <button
                  className={`idea-reference__item${selected ? " idea-reference__item--selected" : ""}`}
                  type="button"
                  key={asset.id}
                  aria-pressed={selected}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "idea-reference-error" : undefined}
                  aria-label={`${asset.filename} 선택`}
                  onClick={() => toggle(asset.id)}
                >
                  <span className="idea-reference__item-icon" aria-hidden="true"><Folder size={20} /></span>
                  <span>{asset.filename}</span>
                  <small>{asset.media_type === "video" ? "영상" : asset.media_type === "image" ? "이미지" : "자료"}</small>
                  {selected ? <span aria-hidden="true">✓</span> : null}
                </button>
              );
            })}
          </div>
        </>
      )}
      {error ? <p className="idea-field__error" id="idea-reference-error" role="alert">{error}</p> : null}
    </section>
  );
}
