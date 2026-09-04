import { GridFour, Lightbulb, VideoCamera } from "@phosphor-icons/react";
import type { IdeaFormat } from "../../app/api";

const FORMAT_OPTIONS: Array<{
  id: IdeaFormat;
  label: string;
  detail: string;
  recommendation: string;
  icon: typeof Lightbulb;
}> = [
  { id: "shorts", label: "쇼츠", detail: "세로 9:16", recommendation: "15~60초 권장", icon: VideoCamera },
  { id: "reels", label: "릴스", detail: "세로 9:16", recommendation: "15~90초 권장", icon: VideoCamera },
  { id: "card_news", label: "카드뉴스", detail: "정사각 1080×1080", recommendation: "5~10장 권장", icon: GridFour },
];

export function formatLabel(format: IdeaFormat): string {
  return FORMAT_OPTIONS.find((option) => option.id === format)?.label ?? format;
}

export function FormatSelector({
  value,
  onChange,
  error,
}: {
  value: IdeaFormat[];
  onChange: (next: IdeaFormat[]) => void;
  error?: string;
}) {
  function toggle(format: IdeaFormat) {
    onChange(value.includes(format) ? value.filter((item) => item !== format) : [...value, format]);
  }

  return (
    <fieldset className="idea-fieldset" aria-describedby={error ? "idea-format-error" : undefined}>
      <legend>
        출력 형식 선택 <span aria-hidden="true">*</span>
      </legend>
      <div className="format-selector" role="group" aria-label="출력 형식">
        {FORMAT_OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = value.includes(option.id);
          return (
            <button
              className={`format-option${selected ? " format-option--selected" : ""}`}
              type="button"
              key={option.id}
              aria-pressed={selected}
              onClick={() => toggle(option.id)}
            >
              <span className="format-option__icon" aria-hidden="true">
                <Icon size={29} weight="regular" />
              </span>
              <span className="format-option__copy">
                <strong>{option.label}</strong>
                <span>{option.detail}</span>
                <small>{option.recommendation}</small>
              </span>
              {selected ? <span className="format-option__check" aria-hidden="true">✓</span> : null}
            </button>
          );
        })}
      </div>
      {error ? <p className="idea-field__error" id="idea-format-error" role="alert">{error}</p> : null}
    </fieldset>
  );
}
