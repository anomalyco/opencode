export const unit = 16;

export const GREY_COLOR = [
  "#1A1A2E", //0
  "#2F2F41", //1
  "#444454", //2
  "#585867", //3
  "#6D6D7A", //4
  "#82828D", //5
  "#9797A0", //6
  "#ACACB3", //7
  "#C1C1C6", //8
  "#D5D5D9", //9
  "#EAEAEC", //10
  "#FFFFFF", //11
];

export const BLUE_COLOR = "#395C6B";
export const DANGER_COLOR = "#ED322C";
export const TEXT_COLOR = GREY_COLOR[0];
export const SECONDARY_COLOR = GREY_COLOR[5];
export const DIMMED_COLOR = GREY_COLOR[7];
export const DIVIDER_COLOR = GREY_COLOR[10];
export const BACKGROUND_COLOR = "#F0F0F1";
export const SURFACE_COLOR = DIVIDER_COLOR;
export const SURFACE_DIVIDER_COLOR = GREY_COLOR[9];

export const body = {
  background: BACKGROUND_COLOR,
};

export const container = {
  minWidth: "600px",
};

export const medium = {
  fontWeight: 500,
};

export const danger = {
  color: DANGER_COLOR,
};

export const frame = {
  padding: `${unit * 1.5}px`,
  border: `1px solid ${SURFACE_DIVIDER_COLOR}`,
  background: "#FFF",
  borderRadius: "6px",
  boxShadow: `0 1px 2px rgba(0,0,0,0.03),
              0 2px 4px rgba(0,0,0,0.03),
              0 2px 6px rgba(0,0,0,0.03)`,
};

export const textColor = {
  color: TEXT_COLOR,
};

export const code = {
  fontFamily: "IBM Plex Mono, monospace",
};

export const headingHr = {
  margin: `${unit}px 0`,
};

export const buttonPrimary = {
  ...code,
  padding: "12px 18px",
  color: "#FFF",
  borderRadius: "4px",
  background: BLUE_COLOR,
  fontSize: "12px",
  fontWeight: 500,
};

export const compactText = {
  margin: "0 0 2px",
};

export const breadcrumb = {
  fontSize: "14px",
  color: SECONDARY_COLOR,
};

export const breadcrumbColonSeparator = {
  padding: " 0 4px",
  color: DIMMED_COLOR,
};

export const breadcrumbSeparator = {
  color: DIVIDER_COLOR,
};

export const heading = {
  fontSize: "22px",
  fontWeight: 500,
};

export const sectionLabel = {
  ...code,
  ...compactText,
  letterSpacing: "0.5px",
  fontSize: "13px",
  fontWeight: 500,
  color: DIMMED_COLOR,
};

export const footerLink = {
  fontSize: "14px",
};
