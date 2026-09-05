# 자막 글꼴 라이선스

## 적용 범위

자막 설정 화면에서 선택할 수 있는 글꼴 목록은 아래 upstream 프로젝트가 공개한 라이선스를 기준으로 관리합니다. 프론트엔드 미리보기에는 각 글꼴의 400·700 한글 웹폰트 subset을 저장소에 포함해 운영체제에 설치되지 않은 글꼴도 동일하게 확인할 수 있도록 합니다.

## 글꼴 목록

| 글꼴 | 라이선스 | upstream / 라이선스 출처 |
| --- | --- | --- |
| Pretendard | SIL Open Font License 1.1 | [orioncactus/pretendard](https://github.com/orioncactus/pretendard) |
| Noto Sans KR | SIL Open Font License 1.1 | [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk) |
| Noto Serif KR | SIL Open Font License 1.1 | [Noto CJK third-party notices](https://github.com/notofonts/noto-cjk/blob/main/Serif/README-third_party.md) |
| SUIT | SIL Open Font License 1.1 | [sun-typeface/SUIT](https://github.com/sun-typeface/SUIT) |
| Spoqa Han Sans Neo | SIL Open Font License 1.1 | [spoqa/spoqa-han-sans](https://github.com/spoqa/spoqa-han-sans) |
| IBM Plex Sans KR | SIL Open Font License 1.1 | [IBM/plex](https://github.com/IBM/plex) |
| 나눔고딕 | SIL Open Font License 1.1 | [Nanum font license reference](https://github.com/namepen/nanum_font/blob/master/OFL.txt) |
| 나눔명조 | SIL Open Font License 1.1 | [Nanum font license reference](https://github.com/namepen/nanum_font/blob/master/OFL.txt) |
| Arial | 시스템 글꼴 | 운영체제 제공 글꼴 |

## 배포 전 체크리스트

- 실행 파일에 글꼴 파일을 번들링할 때는 각 글꼴의 저작권 고지와 SIL Open Font License 1.1 원문을 함께 배포합니다.
- `frontend/src/assets/fonts`의 번들 파일을 실행 파일에 포함할 때도 각 글꼴의 저작권 고지와 SIL Open Font License 1.1 원문을 함께 배포합니다.
- 글꼴을 수정하거나 재배포하는 경우에는 해당 글꼴의 Reserved Font Name 조건과 upstream별 고지사항을 다시 확인합니다.
- 최종 렌더러를 별도 프로세스로 패키징할 때는 같은 번들 글꼴을 렌더러 자산에도 복사해 미리보기와 출력 결과의 모양을 일치시킵니다.
