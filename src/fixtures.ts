// Authored for this public demo. No private conversation, document or media was imported.
export const archiveRevision =
  "655b206ab727568a6ce76ad46b415d0ee06d1abc2485d873000ea02df0b3e387";
export const messages = [
  {
    id: "exhibit-m0001",
    threadId: "exhibit",
    seq: 1,
    role: "user",
    time: "2026-01-12T09:00:00Z",
    text: "동네 도서관에 작은 전시를 열고 싶어요. 주제는 「느리게 보는 도시」로 하고, 방문자가 머물며 관찰할 수 있게 만들죠.",
  },
  {
    id: "exhibit-m0002",
    threadId: "exhibit",
    seq: 2,
    role: "assistant",
    time: "2026-01-12T09:02:00Z",
    text: "전시를 빛, 길, 쉼의 세 구역으로 나누는 안을 제안합니다. 사진과 짧은 글을 함께 두고, 마지막에는 관찰을 기록할 자리를 만들 수 있습니다. 이 내용은 제안이며 확정된 결정은 아닙니다.",
  },
  {
    id: "exhibit-m0003",
    threadId: "exhibit",
    seq: 3,
    role: "user",
    time: "2026-01-12T09:05:00Z",
    text: "세 구역은 좋아요. 다만 큰 스크린 대신 작은 인쇄물과 짧은 영상을 쓰겠습니다. 화면은 음소거가 기본이고 자막을 함께 둡시다.",
  },
  {
    id: "exhibit-m0004",
    threadId: "exhibit",
    seq: 4,
    role: "assistant",
    time: "2026-01-12T09:06:00Z",
    text: "현재 결정: 빛·길·쉼의 세 구역, 작은 인쇄물, 음소거 영상과 자막. 미정: 구역별 작품 수와 공간 크기. 미정인 정보를 보고서에서 확정 사실로 쓰지 않겠습니다.",
  },
  {
    id: "exhibit-m0005",
    threadId: "exhibit",
    seq: 5,
    role: "user",
    time: "2026-01-13T10:00:00Z",
    text: "동선이 짧아서 길 구역을 먼저 두는 안도 검토해봐요. 이건 변경 후보이고 최종 순서는 현장 확인 후 정하겠습니다.",
  },
];
export const noteSeed = {
  "전시 기획.md":
    "---\nstatus: draft\ntags: [전시, 관찰]\n---\n# 느리게 보는 도시\n\n빛, 길, 쉼을 따라 도시를 관찰하는 작은 전시입니다.\n\n- [[빛의 기록]]에서 색과 시간의 단서를 모읍니다.\n- [[동선과 접근성]]에서 이동과 머무는 시간을 검토합니다.\n- [원문 결정](#/thread/exhibit/message/exhibit-m0003?revision=" +
    archiveRevision +
    ")을 먼저 확인합니다.\n\n순서 변경은 아직 후보입니다. #검토",
  "빛의 기록.md":
    "# 빛의 기록\n\n창가의 그림자와 오후의 색을 기록합니다. [[전시 기획]]의 첫 구역 후보입니다.\n\n합성 영상의 2초 지점에서 빛의 변화를 살펴봅니다. #관찰",
  "동선과 접근성.md":
    "# 동선과 접근성\n\n[[전시 기획]]의 세 구역은 아직 배치가 확정되지 않았습니다.\n\n영상은 음소거가 기본이며 자막을 함께 둡니다. #접근성",
};
export const canvasSeed = JSON.stringify(
  {
    nodes: [
      {
        id: "question",
        type: "text",
        text: "어떻게 더 느리게 볼 수 있을까?",
        x: 0,
        y: 0,
        width: 250,
        height: 140,
        color: "5",
      },
      {
        id: "plan",
        type: "file",
        file: "전시 기획.md",
        x: 340,
        y: 0,
        width: 240,
        height: 140,
      },
      {
        id: "decision",
        type: "text",
        text: "결정: 작은 인쇄물 + 자막 영상\n미정: 구역의 최종 순서",
        x: 340,
        y: 240,
        width: 260,
        height: 150,
        color: "4",
      },
    ],
    edges: [
      {
        id: "e1",
        fromNode: "question",
        fromSide: "right",
        toNode: "plan",
        toSide: "left",
      },
      {
        id: "e2",
        fromNode: "plan",
        fromSide: "bottom",
        toNode: "decision",
        toSide: "top",
      },
    ],
  },
  null,
  2,
);
export const references = [
  {
    id: "light",
    title: "창가의 오후",
    category: "색과 빛",
    image: "./assets/light.svg",
    text: "면과 그림자의 대비를 살펴보는 합성 이미지.",
  },
  {
    id: "route",
    title: "세 개의 길",
    category: "동선",
    image: "./assets/route.svg",
    text: "서로 다른 속도로 걷는 세 경로를 그린 합성 도형.",
  },
  {
    id: "rest",
    title: "머무는 자리",
    category: "쉼",
    image: "./assets/rest.svg",
    text: "여백과 좌석의 관계를 표현한 합성 이미지.",
  },
  {
    id: "type",
    title: "작은 안내문",
    category: "타이포그래피",
    image: "./assets/type.svg",
    text: "짧고 명확한 안내문을 위한 조판 연습.",
  },
];
export const mediaSeed = [
  {
    id: "window-light",
    title: "빛의 변화 · 6초",
    author: "PAW demo",
    caption: "창가의 빛과 그림자를 단순한 도형으로 표현했습니다.",
    captionStatus: "authored",
    commentsStatus: "not-collected",
    mediaStatus: "available",
    kind: "video",
    knownMediaCount: 1,
    assets: [
      { role: "video", ordinal: 0, src: "./assets/light.webm" },
      { role: "poster", ordinal: 0, src: "./assets/light.svg" },
    ],
    reading: {
      asr: {
        status: "authored-fixture",
        segments: [
          {
            text: "빛이 천천히 나타나고 사라집니다.",
            start: 2,
            end: 4,
            ordinal: 0,
          },
        ],
      },
      ocr: { status: "not-analyzed", segments: [] },
    },
    comments: [],
  },
  {
    id: "layout-study",
    title: "색과 여백 · 3장",
    author: "PAW demo",
    caption: "전시의 색과 동선을 검토하기 위한 합성 이미지 모음.",
    captionStatus: "authored",
    commentsStatus: "not-collected",
    mediaStatus: "available",
    kind: "carousel",
    knownMediaCount: 3,
    assets: references
      .slice(0, 3)
      .map((r, i) => ({ role: "image", ordinal: i, src: r.image })),
    reading: {
      ocr: {
        status: "authored-fixture",
        segments: [
          { text: "세 개의 길, 천천히 걷는 전시", start: 0, ordinal: 1 },
        ],
      },
      asr: { status: "not-analyzed", segments: [] },
    },
    comments: [],
  },
];
export function initialState() {
  return {
    schema: 1,
    notes: { ...noteSeed },
    canvas: canvasSeed,
    knowledge: {
      revision: 1,
      content:
        "# 느리게 보는 도시\n\n전시는 빛·길·쉼의 세 구역을 다룬다. 작은 인쇄물과 음소거 영상, 자막을 사용한다.\n\n구역의 최종 순서와 작품 수는 미정이다.",
      history: [],
      proposals: [],
      applied: {},
      observations: [],
    },
    boards: {
      schemaVersion: 1,
      revision: 0,
      updatedAt: null,
      boards: [
        { id: "inspiration", title: "전시 레퍼런스", createdAt: null },
        { id: "shortlist", title: "선정 후보", createdAt: null },
      ],
      items: Object.fromEntries(
        references.map((r) => [
          r.id,
          {
            boards: ["inspiration"],
            favorite: r.id === "light",
            tags: [r.category],
            notes: "",
            sections: {},
          },
        ]),
      ),
    },
  };
}
