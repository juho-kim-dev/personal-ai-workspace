# PAW — Personal AI Workflow

A modular Personal AI Workspace.

**원문을 남기고, 자료를 연결하고, 작업을 이어갑니다.**

[English](README.md) · [공개 방향과 명칭](docs/PUBLIC-DIRECTION.md) · [위키 로컬 실행](sites/wiki/README.md)

기존 웹사이트의 화면과 기능을 유지하고 공개 이름을 적용한 독립 사이트들을 공개합니다. 실제 개인 사용 중 쌓인 문서·대화·첨부·운영 데이터는 제외합니다. **PAW - Wiki가 기존 Wiki42 대문을 바탕으로 중심 허브와 위키 역할을 맡습니다.**

| 기존 제품 | 공개 제목 | 현재 범위 |
| --- | --- | --- |
| Wiki42 | PAW - Wiki | 첫 로컬 미리보기 · 중심 허브 |
| Yarnbox | PAW - Yarns | 공개 예정 |
| Naid | PAW - Canvas | 공개 예정 |
| Yeobaek | PAW - Office | 공개 예정 |
| Nalanhi | PAW - Study | 공개 예정 |
| Tseret | PAW - Boards | 공개 예정 |
| Marga | PAW - Library | 공개 예정 |
| Acra | PAW - Forum | 공개 예정 |
| Tig | PAW - Git | 목표 Space · 구현 범위 별도 확인 |
| — | PAW - Studio | 향후 후보 |

이크나·Alder·Cedar·우만위키는 현재 공개 계획에서 제외합니다. SWU는 별도 도구와 저장소로 유지합니다.

여섯 역할을 한 화면에 묶었던 축약 데모와 ‘정확히 여섯 사이트·허브 없음’ 계획은 이 결정으로 대체합니다. 기존 `src/` 시제품은 참고 이력으로만 보존합니다. 각 사이트의 실제 소스를 바탕으로 독립 실행·저장·배포를 준비하며, 위키에서 확인된 공개 주소를 연결합니다.

현재 `sites/wiki/`는 최신 확인 Git main을 사용한 로컬 준비본입니다. 새 로컬 저장소와 제품 시작 안내만 사용하며 개인 데이터를 이관하지 않았습니다. 아직 보조계정 Sites 배포·공개 URL·main 병합 완료를 뜻하지 않습니다.

## PAW - Canvas

**문서와 데이터를 펼치고, 관계와 현재 상태를 연결해 보는 시각적 작업 공간.** 당장은 기존 Markdown 편집·Graph·Canvas를 잇는 노트맵에서 출발합니다. PAW 객체 상태 시각화, Wiki 등 다른 Space에 재사용하는 Tool·임베드, AI 제안 검토, JSON·차트·자동 실행은 앞으로의 목표입니다. [정체성·용도·현재 기반·개발 순서](docs/CANVAS.md). 공개 Canvas 이식·배포는 아직입니다.

Spaces는 웹앱, Tools는 재사용 기능, Objects는 다루는 자료, Core는 공통 참조·관계·권한·연동 기반입니다. 독립 배포를 앱마다 같은 원본을 복제한다는 뜻으로 해석하지 않습니다. 공개 환경은 비공개 운영 자료와 분리합니다. 목표 명칭·로고와 실제 미리보기 화면의 반영 상태는 별개이며 이번 변경은 문서에 한정됩니다.
