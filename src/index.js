require('dotenv').config();

const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');

const app = express();

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const blobClient = new line.messagingApi.MessagingApiBlobClient({
  channelAccessToken: config.channelAccessToken,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pendingCrossChecks = {};

// 여기에 //방정보 로 확인한 groupId를 넣으면 돼.
const GROUP_PROJECT_MAP = {
  // 'Cc4230c46499f5ae95a973224319b3a51': 'undecember',
  // 'C0cd3ba8f6f4ef6b34360e53ffe2da7be': 'fairy_tale_quest',
};

function getSourceId(source) {
  return source.groupId || source.roomId || source.userId;
}

function getProjectName(projectKey) {
  if (projectKey === 'undecember') return '언디셈버';
  if (projectKey === 'fairy_tale_quest') return '페어리테일 퀘스트';
  return '미설정';
}

function getPrompt(projectKey) {
  if (projectKey === 'undecember') {
    return `
너는 언디셈버 운영툴 전문 검수 AI다.

이 이미지는 반드시 "언디셈버" 프로젝트 화면이다.
프로젝트명을 다른 게임으로 판단하지 마라.

[검수 가능 화면]
- 개별 메일 보내기
- 전체 메일 보내기
- CSV 메일 보내기
- 인게임 공지

[공통 규칙]
- 화면 종류를 판단한다.
- 설정된 기간, 리전, 대상, 우편 종류를 추출한다.
- 확인 불가능한 값은 "확인 불가"로 표시한다.
- 추측하지 않는다.
- 설명형 문장은 최소화한다.
- "특이사항" 항목은 출력하지 않는다.

[메일 검수 규칙]
- 메일 보상은 반드시 리스트 영역을 기준으로 판단한다.
- 입력 영역에 보상이 보여도 리스트에 없으면 지급 보상으로 판단하지 않는다.
- 개별 메일은 NID/계정/캐릭터 대상 여부를 확인한다.
- 전체 메일은 리전, 유저 타입, 이벤트 시작/종료 시간, 보관 기간을 확인한다.
- CSV 메일은 대상ID,보상타입,보상ID,수량 구조로 판단한다.
- CSV 메일은 입력 개수와 CSV 리스트 보상ID/수량을 확인한다.

[인게임 공지 검수 규칙]
- 적용 리전을 확인한다.
- 공지 타입을 확인한다.
- 긴급 공지 여부를 확인한다.
- 공지 시작/종료 시간을 확인한다.
- 권장 업데이트 안내 여부를 확인한다.

[출력 형식]
[언디셈버 - 화면 종류]

기간:
- 시작: ...
- 종료: ...

리전:
- ...

대상:
- ...

설정 보상:
- ...

우편/공지 정보:
- ...

검수 결과:
- 확인된 내용만 간단히 작성
`;
  }

  if (projectKey === 'fairy_tale_quest') {
    return `
너는 페어리테일 퀘스트 운영툴 전문 검수 AI다.

이 이미지는 반드시 "페어리테일 퀘스트" 프로젝트 화면이다.
프로젝트명을 언디셈버 또는 다른 게임으로 판단하지 마라.

[검수 가능 화면]
- 전체 메일 보내기
- 인게임 공지

[공통 규칙]
- 화면 종류를 판단한다.
- 설정된 기간, 마켓, 대상, 보상 정보를 추출한다.
- 확인 불가능한 값은 "확인 불가"로 표시한다.
- 추측하지 않는다.
- 설명형 문장은 최소화한다.
- "특이사항" 항목은 출력하지 않는다.

[전체 메일 검수 규칙]
- Rewards 영역을 기준으로 보상을 판단한다.
- Purpose, Date, 보상 만료 시간, Market, Type, PostNo를 확인한다.
- 보상명과 수량을 추출한다.
- 언어별 템플릿 제목/내용이 보이면 입력 여부만 확인한다.

[인게임 공지 검수 규칙]
- Purpose를 확인한다.
- Notice Type을 확인한다.
- Notice Period를 확인한다.
- Notice Date 시작/종료 시간을 확인한다.
- App Market을 확인한다.
- App Version을 확인한다.
- KO, EN, JP, ID, ZH-HANT, TH, PT, ES 언어별 입력 여부를 확인한다.

[출력 형식]
[페어리테일 퀘스트 - 화면 종류]

기간:
- 시작: ...
- 종료: ...

마켓:
- ...

설정 보상:
- ...

공지/메일 정보:
- ...

언어 입력 상태:
- ...

검수 결과:
- 확인된 내용만 간단히 작성
`;
  }

  return `
너는 게임 운영툴 전문 검수 AI다.

프로젝트가 설정되지 않은 채팅방이다.
이미지에서 보이는 내용만 검수하되, 프로젝트명은 "미설정"으로 출력한다.
추측하지 않는다.
"특이사항" 항목은 출력하지 않는다.
`;
}

app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events;

    for (const event of events) {
      const sourceId = getSourceId(event.source);
      const projectKey = GROUP_PROJECT_MAP[sourceId];

      if (event.type === 'message' && event.message.type === 'image') {
        if (!pendingCrossChecks[sourceId]) {
          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: 'text',
                text: '먼저 //크로스체크 를 입력해주세요.',
              },
            ],
          });
          return;
        }

        console.log('이미지 업로드 감지');

        const imageStream = await blobClient.getMessageContent(event.message.id);
        const chunks = [];

        for await (const chunk of imageStream) {
          chunks.push(chunk);
        }

        const imageBuffer = Buffer.concat(chunks);
        const base64Image = imageBuffer.toString('base64');

        const response = await openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: getPrompt(projectKey),
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`,
                  },
                },
              ],
            },
          ],
        });

        const result = response.choices[0].message.content;

        console.log(result);

        delete pendingCrossChecks[sourceId];

        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [
            {
              type: 'text',
              text: result,
            },
          ],
        });

        return;
      }

      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text.trim();

        console.log('받은 메시지:', userMessage);

        if (userMessage === '//방정보') {
          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: 'text',
                text:
                  `채팅방 정보\n` +
                  `sourceId: ${sourceId}\n` +
                  `type: ${event.source.type}\n` +
                  `project: ${getProjectName(projectKey)}`,
              },
            ],
          });

          return;
        }

        if (userMessage === '//크로스체크') {
          pendingCrossChecks[sourceId] = {
            startedAt: Date.now(),
          };

          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: 'text',
                text:
                  `크로스체크를 시작합니다.\n` +
                  `프로젝트: ${getProjectName(projectKey)}\n` +
                  `5분 내로 이미지를 업로드해주세요.`,
              },
            ],
          });

          return;
        }

        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [
            {
              type: 'text',
              text: `메시지 확인: ${userMessage}`,
            },
          ],
        });
      }
    }

    res.status(200).end();
  } catch (error) {
    console.error(error);
    res.status(500).end();
  }
});

app.get('/', (req, res) => {
  res.send('LINE CrossCheck Bot 서버 정상 동작중!');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`서버 실행중 : ${PORT}`);
});