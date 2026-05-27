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

app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events;

    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'image') {
        const userId = event.source.userId;

        if (!pendingCrossChecks[userId]) {
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
                  text: `
너는 게임 운영툴 전문 검수 AI다.

이미지를 분석하여 반드시 아래 프로젝트 및 화면 중 하나로 분류하라.

[프로젝트 분류]

1. 언디셈버
- 개별 메일 보내기
- 전체 메일 보내기
- CSV 메일 보내기
- 인게임 공지

2. 페어리테일 퀘스트
- 전체 메일 보내기
- 인게임 공지

[검수 규칙]

공통:
- 프로젝트명을 반드시 판단한다.
- 화면 종류를 반드시 판단한다.
- 설정된 보상 정보를 추출한다.
- 기간/리전/우편 종류를 추출한다.
- 실수 또는 위험 요소를 찾는다.
- 설명형 문장은 최소화한다.
- 운영 검수 보고서 형태로 출력한다.

언디셈버:
- 개별 메일 여부 확인
- 전체 메일 여부 확인
- CSV 업로드 여부 확인
- 리전 설정 확인
- 시즌/Both 설정 확인
- 우편 보관 기간 확인
- NID 리스트/리스트 입력 개수 확인
- 메일 보상은 리스트 영역을 기준으로 판단한다.
- CSV 메일은 대상ID,보상타입,보상ID,수량 구조로 판단한다.

페어리테일 퀘스트:
- 전체 메일 여부 확인
- 인게임 공지 여부 확인
- 반복 공지 여부 확인
- 공지 시간 확인
- Rewards 영역을 기준으로 보상을 판단한다.
- 공지는 언어별 입력 여부를 확인한다.

[출력 규칙]
- 반드시 검수 보고서 형식으로 출력한다.
- 확인 불가능한 값은 "확인 불가"로 표시한다.
- 추측하지 않는다.
- 특이사항이 없으면 "특이사항 없음"이라고 표시한다.
`,
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

        delete pendingCrossChecks[userId];

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
        const userMessage = event.message.text;
        const userId = event.source.userId;

        console.log('받은 메시지:', userMessage);

        if (userMessage === '//크로스체크') {
          pendingCrossChecks[userId] = {
            startedAt: Date.now(),
          };

          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: 'text',
                text: '크로스체크를 시작합니다.\n5분 내로 이미지를 업로드해주세요.',
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