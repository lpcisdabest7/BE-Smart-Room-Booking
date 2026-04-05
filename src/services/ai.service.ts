import OpenAI from 'openai';
import { config } from '../config';
import { AIResponse, ChatMessage } from '../types';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

function vnNow() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gu, 'd')
    .toLowerCase()
    .trim();
}

function resolveRelativeDate(message: string): string | null {
  const normalized = normalizeText(message);
  const now = vnNow();
  if (normalized.includes('hom nay') || normalized.includes('today')) {
    return now.toISOString().slice(0, 10);
  }
  if (normalized.includes('ngay mai') || normalized.includes('tomorrow')) {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  const explicit = normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return explicit?.[1] ?? null;
}

function resolveTime(message: string): string | null {
  const normalized = normalizeText(message);
  const range = normalized.match(/(\d{1,2})(?:[:h](\d{2}))?\s*(?:-|den|toi)\s*(\d{1,2})(?:[:h](\d{2}))?/);
  if (range) {
    const hour = Number(range[1]);
    const minute = Number(range[2] ?? '00');
    if (hour <= 23 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  const match = normalized.match(/\b(\d{1,2})(?:[:h](\d{2}))?\b/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? '00');
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function resolveDuration(message: string): number | null {
  const normalized = normalizeText(message);
  const hours = normalized.match(/(\d+)\s*(gio|tieng|h)\b/);
  if (hours) return Number(hours[1]) * 60;
  const minutes = normalized.match(/(\d+)\s*(phut|m)\b/);
  if (minutes) return Number(minutes[1]);
  const range = normalized.match(/(\d{1,2})(?:[:h](\d{2}))?\s*(?:-|den|toi)\s*(\d{1,2})(?:[:h](\d{2}))?/);
  if (range) {
    const startMinutes = Number(range[1]) * 60 + Number(range[2] ?? '00');
    const endMinutes = Number(range[3]) * 60 + Number(range[4] ?? '00');
    return endMinutes > startMinutes ? endMinutes - startMinutes : null;
  }
  return 60;
}

function resolvePeople(message: string): number {
  const normalized = normalizeText(message);
  const match = normalized.match(/(\d+)\s*(nguoi|ng)\b/);
  return match ? Number(match[1]) : 1;
}

function resolveRoomName(message: string): string | undefined {
  const normalized = normalizeText(message);
  const room = config.rooms.find((item) => normalized.includes(normalizeText(item.name)));
  return room?.name;
}

function resolveMonthYear(message: string): { month?: number; year?: number } {
  const normalized = normalizeText(message);
  const monthMatch = normalized.match(/thang\s*(\d{1,2})/);
  const yearMatch = normalized.match(/(20\d{2})/);

  const month = monthMatch ? Number(monthMatch[1]) : undefined;
  const year = yearMatch ? Number(yearMatch[1]) : undefined;

  return {
    month: month && month >= 1 && month <= 12 ? month : undefined,
    year,
  };
}

function isRoomScheduleIntent(normalized: string): boolean {
  const hasRoomKeyword = /(phong|room)/.test(normalized);
  const hasScheduleKeyword = /(lich|lich dat|da dat|dat trong thang|thang)/.test(normalized);
  const asksMine = /(lich cua toi|booking cua toi|check booking cua toi|check lich cua toi)/.test(normalized);
  return hasRoomKeyword && hasScheduleKeyword && !asksMine;
}

function parseCommonCommand(message: string): AIResponse | null {
  const normalized = normalizeText(message);
  const date = resolveRelativeDate(message);
  const startTime = resolveTime(message);
  const duration = resolveDuration(message) ?? 60;
  const numberOfPeople = resolvePeople(message);
  const roomName = resolveRoomName(message);
  const { month, year } = resolveMonthYear(message);

  if (/(danh sach phong|co may phong|tat ca phong|list phong)/.test(normalized)) {
    return { action: 'list_rooms', message: 'Đây là danh sách phòng hiện có.' };
  }

  if (isRoomScheduleIntent(normalized)) {
    return {
      action: 'check_room_schedule',
      params: { roomName, month, year },
      message: 'Để tôi kiểm tra lịch của phòng.',
    };
  }

  if (/(lich cua toi|booking cua toi|kiem tra booking|kiem tra lich|da dat chua|check lich|lich su)/.test(normalized)) {
    return { action: 'check_booking', message: 'Để tôi kiểm tra lịch của bạn.' };
  }

  if (/(dat phong|book phong|dat giup|dat ngay|book ngay)/.test(normalized)) {
    if (!date || !startTime) {
      return { action: 'clarify', message: 'Bạn muốn đặt phòng vào ngày nào và lúc mấy giờ?' };
    }
    return {
      action: 'book',
      params: { roomName, numberOfPeople, date, startTime, duration },
    };
  }

  if (/(phong trong|con phong nao trong|check phong|tim phong|phong nao trong)/.test(normalized)) {
    if (!date || !startTime) {
      return { action: 'clarify', message: 'Bạn muốn kiểm tra phòng vào ngày nào và lúc mấy giờ?' };
    }
    return {
      action: 'search',
      params: { numberOfPeople, date, startTime, duration },
    };
  }

  return null;
}

function buildSystemPrompt(): string {
  const now = vnNow();
  const roomsInfo = config.rooms.map((room) => `- ${room.name}: tối đa ${room.capacity} người (id: ${room.id})`).join('\n');

  return `Bạn là trợ lý đặt phòng họp cho Apero.
Hôm nay là ${now.toISOString().slice(0, 10)}, giờ hiện tại là ${now.toISOString().slice(11, 16)} (GMT+7).

Danh sách phòng:
${roomsInfo}

Nhiệm vụ:
- Nếu người dùng muốn xem phòng trống hoặc kiểm tra phòng: action = "search"
- Nếu người dùng muốn đặt phòng: action = "book"
- Nếu người dùng muốn kiểm tra lịch đã đặt của chính họ: action = "check_booking"
- Nếu người dùng muốn kiểm tra lịch của một phòng: action = "check_room_schedule"
- Nếu người dùng hỏi danh sách phòng: action = "list_rooms"
- Nếu thiếu ngày hoặc giờ: action = "clarify"

Luôn trả JSON hợp lệ. Luôn dùng tiếng Việt có dấu.
Mặc định duration = 60 phút, numberOfPeople = 1.`;
}

export async function processChat(message: string, conversationHistory: ChatMessage[] = []): Promise<AIResponse> {
  const quick = parseCommonCommand(message);
  if (quick) return quick;

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: buildSystemPrompt() },
    ...conversationHistory.map((msg) => ({ role: msg.role as 'user' | 'assistant', content: msg.content })),
    { role: 'user', content: message },
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: config.aiModel,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 400,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return { action: 'clarify', message: 'Xin lỗi, tôi chưa hiểu rõ yêu cầu. Bạn có thể nói rõ hơn không?' };
    }

    const parsed = JSON.parse(content) as AIResponse;
    if (parsed.action === 'search' && parsed.params?.date && parsed.params?.startTime) {
      return {
        action: 'search',
        params: {
          ...parsed.params,
          numberOfPeople: parsed.params.numberOfPeople || 1,
          duration: parsed.params.duration || 60,
        },
      };
    }
    if (parsed.action === 'book' && parsed.params?.date && parsed.params?.startTime) {
      return {
        action: 'book',
        params: {
          ...parsed.params,
          numberOfPeople: parsed.params.numberOfPeople || 1,
          duration: parsed.params.duration || 60,
        },
      };
    }
    if (parsed.action === 'check_room_schedule') {
      const loose = parsed as unknown as {
        params?: { roomName?: string; month?: number; year?: number };
        roomName?: string;
        room_name?: string;
        room?: string;
        room_id?: string;
        month?: number;
        year?: number;
      };

      const resolvedRoomName =
        loose.params?.roomName ??
        loose.roomName ??
        loose.room_name ??
        loose.room ??
        config.rooms.find((room) => room.id === loose.room_id)?.name;

      return {
        action: 'check_room_schedule',
        params: {
          roomName: resolvedRoomName,
          month: loose.params?.month ?? loose.month,
          year: loose.params?.year ?? loose.year,
        },
        message: 'Để tôi kiểm tra lịch của phòng.',
      };
    }
    if (parsed.action === 'check_booking' || parsed.action === 'list_rooms' || parsed.action === 'info') {
      return parsed;
    }
    return { action: 'clarify', message: 'Bạn muốn xem phòng trống hay đặt phòng?' };
  } catch (error) {
    console.error('AI service error:', error);
    return { action: 'clarify', message: 'Xin lỗi, tôi đang gặp sự cố khi hiểu yêu cầu. Bạn thử lại giúp tôi nhé.' };
  }
}
