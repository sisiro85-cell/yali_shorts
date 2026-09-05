import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ProgressSteps } from "./ProgressSteps";

test("renders 영상 설정 between 디자인 and 출력", () => {
  render(<ProgressSteps stage="video_settings" />);

  expect(screen.getByText("디자인")).toBeInTheDocument();
  expect(screen.getByText("영상 설정")).toBeInTheDocument();
  expect(screen.getByText("출력")).toBeInTheDocument();
  expect(document.querySelector('[aria-current="step"]')).toHaveTextContent("영상 설정");
});
