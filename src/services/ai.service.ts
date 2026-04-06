import OpenAI from 'openai';
import { config } from '../config';
import { AIResponse, ChatMessage } from '../types';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

function vnNow(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDmyToDate(day: number, month: number, year: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

function resolveWeekday(normalized: string): number | null {
  if (/\b(cn|chu nhat|chu nhut|sunday)\b/.test(normalized)) {
    return 0;
  }

  const weekdayTextMap: Record<string, number> = {
    hai: 1,
    ba: 2,
    tu: 3,
    bon: 3,
    nam: 4,
    sau: 5,
    bay: 6,
  };

  const thuMatch = normalized.match(/\bthu\s*([2-7])\b/);
  if (thuMatch) {
    return Number(thuMatch[1]) - 1;
  }

  const thuTextMatch = normalized.match(/\bthu\s*(hai|ba|tu|bon|nam|sau|bay)\b/);
  if (thuTextMatch) {
    return weekdayTextMap[thuTextMatch[1]] ?? null;
  }

  const shortMatch = normalized.match(/\bt\s*([2-7])\b/);
  if (shortMatch) {
    return Number(shortMatch[1]) - 1;
  }

  const englishMatch = normalized.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (englishMatch) {
    const englishMap: Record<string, number> = {
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    return englishMap[englishMatch[1]] ?? null;
  }

  return null;
}

function resolveRelativeDate(message: string): string | null {
  const normalized = normalizeText(message);
  const now = vnNow();

  if (/\b(hom nay|today)\b/.test(normalized)) {
    return toIsoDate(now);
  }

  if (/\b(ngay mai|mai|tomorrow)\b/.test(normalized)) {
    return toIsoDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  }

  if (/\b(ngay kia)\b/.test(normalized)) {
    return toIsoDate(new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000));
  }

  const weekday = resolveWeekday(normalized);
  if (weekday !== null) {
    const todayWeekday = now.getUTCDay();
    let dayOffset = (weekday - todayWeekday + 7) % 7;
    const hasNextWeekHint = /\b(tuan sau|tuan toi|next week)\b/.test(normalized);
    if (hasNextWeekHint) {
      dayOffset += 7;
    }
    return toIsoDate(new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000));
  }

  const iso = normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso?.[1]) {
    return iso[1];
  }

  const dmy = normalized.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/);
  if (!dmy) {
    return null;
  }

  const day = Number(dmy[1]);
  const month = Number(dmy[2]);
  const year = dmy[3] ? Number(dmy[3]) : now.getUTCFullYear();
  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }

  return toIsoDate(parseDmyToDate(day, month, year));
}

function resolveTime(message: string): string | null {
  const normalized = normalizeText(message);

  const contextual = normalized.match(
    /(?:luc|vao|at)\s*(\d{1,2})(?:[:h.](\d{1,2}))?\s*(sang|chieu|toi|dem|am|pm)?/
  );
  if (contextual) {
    let hour = Number(contextual[1]);
    const minute = Number(contextual[2] ?? '00');
    const period = contextual[3] ?? '';
    if (Number.isNaN(hour) || Number.isNaN(minute) || hour > 23 || minute > 59) {
      return null;
    }
    if ((period === 'pm' || period === 'chieu' || period === 'toi') && hour < 12) {
      hour += 12;
    }
    if ((period === 'am' || period === 'sang') && hour === 12) {
      hour = 0;
    }
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const withPeriod = normalized.match(/\b(\d{1,2})(?:[:h](\d{1,2}))?\s*(sang|chieu|toi|dem|am|pm)\b/);
  if (withPeriod) {
    let hour = Number(withPeriod[1]);
    const minute = Number(withPeriod[2] ?? '00');
    const period = withPeriod[3];
    if (Number.isNaN(hour) || Number.isNaN(minute) || hour > 23 || minute > 59) {
      return null;
    }
    if ((period === 'pm' || period === 'chieu' || period === 'toi') && hour < 12) {
      hour += 12;
    }
    if ((period === 'am' || period === 'sang') && hour === 12) {
      hour = 0;
    }
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const range = normalized.match(/(\d{1,2})(?:[:h](\d{2}))?\s*(?:-|den|toi)\s*(\d{1,2})(?:[:h](\d{2}))?/);
  if (range) {
    const hour = Number(range[1]);
    const minute = Number(range[2] ?? '00');
    if (hour <= 23 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  const explicit = normalized.match(/\b(\d{1,2})(?:[:h](\d{1,2}))\b/);
  if (explicit) {
    const hour = Number(explicit[1]);
    const minute = Number(explicit[2] ?? '00');
    if (hour <= 23 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  const hourOnly = normalized.match(/\b(\d{1,2})\s*h\b/);
  if (hourOnly) {
    const hour = Number(hourOnly[1]);
    if (hour <= 23) {
      return `${String(hour).padStart(2, '0')}:00`;
    }
  }

  const wordHour = normalized.match(/\b(\d{1,2})\s*(gio|tieng)\b/);
  if (wordHour) {
    const hour = Number(wordHour[1]);
    if (hour <= 23) {
      return `${String(hour).padStart(2, '0')}:00`;
    }
  }

  const match = normalized.match(/\b(\d{1,2})[:h](\d{1,2})\b/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2] ?? '00');
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function resolveDurationHint(message: string): number | null {
  const normalized = normalizeText(message);

  const contextual = normalized.match(
    /(?:trong vong|trong|keo dai|duration|hop trong|for)\s*(\d+)\s*(gio|tieng|phut|m|p|h)\b/
  );
  if (contextual) {
    const value = Number(contextual[1]);
    const unit = contextual[2];
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    if (unit === 'phut' || unit === 'm' || unit === 'p') {
      return value;
    }
    return value * 60;
  }

  const hours = normalized.match(/(\d+)\s*(gio|tieng)\b/);
  if (hours) return Number(hours[1]) * 60;

  const shortHours = normalized.match(/(?:hop|meeting|keo dai|trong vong)\s*(\d+)\s*h\b/);
  if (shortHours) return Number(shortHours[1]) * 60;

  const minutes = normalized.match(/(\d+)\s*(phut|m|p)\b/);
  if (minutes) return Number(minutes[1]);

  const range = normalized.match(/(\d{1,2})(?:[:h](\d{2}))?\s*(?:-|den|toi)\s*(\d{1,2})(?:[:h](\d{2}))?/);
  if (range) {
    const startMinutes = Number(range[1]) * 60 + Number(range[2] ?? '00');
    const endMinutes = Number(range[3]) * 60 + Number(range[4] ?? '00');
    if (endMinutes > startMinutes) {
      return endMinutes - startMinutes;
    }
  }

  return null;
}

function resolveDuration(message: string): number {
  return resolveDurationHint(message) ?? 60;
}

function resolvePeopleHint(message: string): number | null {
  const normalized = normalizeText(message);
  const match = normalized.match(/(\d+)\s*(nguoi|ng)\b/);
  return match ? Number(match[1]) : null;
}

function resolvePeople(message: string): number {
  return resolvePeopleHint(message) ?? 1;
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
  const now = vnNow();

  const month = monthMatch ? Number(monthMatch[1]) : undefined;
  const year = yearMatch ? Number(yearMatch[1]) : now.getUTCFullYear();

  return {
    month: month && month >= 1 && month <= 12 ? month : undefined,
    year,
  };
}

function hasBookIntent(normalized: string): boolean {
  return /(dat phong|dat lich|book phong|book lich|tao booking|tao lich|len lich)/.test(normalized);
}

function hasSearchIntent(normalized: string): boolean {
  return /(phong trong|con phong nao|tim phong|check phong|xem phong trong|cho toi.*phong|can.*phong|room available|goi y phong|de xuat phong|tu van phong|suggest room|nen chon phong nao|find room|search room)/.test(
    normalized
  );
}

function hasRecommendationIntent(normalized: string): boolean {
  return /(goi y phong|de xuat phong|tu van phong|suggest room|nen chon phong nao)/.test(normalized);
}

function buildRoomSuggestionSnippet(limit = 3): string {
  const suggestions = config.rooms
    .slice()
    .sort((a, b) => a.capacity - b.capacity)
    .slice(0, limit)
    .map((room) => `${room.name} (${room.capacity} người)`);

  return suggestions.length ? suggestions.join(', ') : 'chọn phòng phù hợp số người tham gia';
}

function parseCommonCommand(message: string): AIResponse | null {
  const normalized = normalizeText(message);
  const date = resolveRelativeDate(message);
  const startTime = resolveTime(message);
  const duration = resolveDuration(message);
  const numberOfPeople = resolvePeople(message);
  const roomName = resolveRoomName(message);
  const { month, year } = resolveMonthYear(message);

  if (/^(hi|hello|hey|xin chao|chao)(\s|$)/.test(normalized)) {
    return {
      action: 'info',
      message: 'Chào bạn, mình có thể giúp: tìm phòng trống, đặt phòng, kiểm tra lịch phòng và lịch của bạn theo UTC+7.',
    };
  }

  if (/(danh sach phong|co may phong|tat ca phong|list phong)/.test(normalized)) {
    return { action: 'list_rooms', message: 'Mình sẽ hiển thị danh sách phòng hiện có.' };
  }

  const roomScheduleIntent =
    /(phong|room)/.test(normalized) &&
    /(lich|da dat|dat trong thang|thang|schedule|trong thang)/.test(normalized) &&
    !/(lich cua toi|booking cua toi)/.test(normalized);
  if (roomScheduleIntent) {
    return {
      action: 'check_room_schedule',
      params: { roomName, month, year },
      message: 'Mình sẽ kiểm tra lịch của phòng theo dữ liệu mới nhất.',
    };
  }

  if (/(lich cua toi|booking cua toi|kiem tra booking|kiem tra lich|da dat chua|check lich|lich su)/.test(normalized)) {
    return { action: 'check_booking', message: 'Mình sẽ kiểm tra lịch của bạn theo dữ liệu mới nhất.' };
  }

  const bookIntent = hasBookIntent(normalized);
  if (bookIntent) {
    if (!date || !startTime) {
      const missing: string[] = [];
      if (!date) missing.push('ngày');
      if (!startTime) missing.push('giờ bắt đầu');
      return {
        action: 'clarify',
        message: `Để đặt phòng chính xác, bạn cho mình ${missing.join(' và ')} nhé.`,
      };
    }
    return {
      action: 'book',
      params: { roomName, numberOfPeople, date, startTime, duration },
    };
  }

  const searchIntent = hasSearchIntent(normalized);
  if (searchIntent) {
    if (!date || !startTime) {
      const missing: string[] = [];
      if (!date) missing.push('ngày');
      if (!startTime) missing.push('giờ bắt đầu');
      const recommendationTail = hasRecommendationIntent(normalized)
        ? ` Gợi ý nhanh: ${buildRoomSuggestionSnippet()}.`
        : '';
      return {
        action: 'clarify',
        message: `Để gợi ý đúng trọng tâm, bạn cho mình ${missing.join(' và ')} nhé.${recommendationTail}`,
      };
    }
    return {
      action: 'search',
      params: { numberOfPeople, date, startTime, duration },
    };
  }

  return null;
}

function buildContextualBookingFollowup(message: string, conversationHistory: ChatMessage[]): AIResponse | null {
  const hintedDate = resolveRelativeDate(message);
  const hintedStartTime = resolveTime(message);
  const hintedDuration = resolveDurationHint(message);
  const hintedPeople = resolvePeopleHint(message);
  const hintedRoomName = resolveRoomName(message);

  const hasAnyHint =
    hintedDate !== null ||
    hintedStartTime !== null ||
    hintedDuration !== null ||
    hintedPeople !== null ||
    typeof hintedRoomName === 'string';
  if (!hasAnyHint) {
    return null;
  }

  let baseAction: AIResponse | null = null;
  for (let i = conversationHistory.length - 1; i >= 0; i -= 1) {
    const item = conversationHistory[i];
    if (item.role !== 'user') {
      continue;
    }
    const parsed = parseCommonCommand(item.content);
    if (parsed && (parsed.action === 'search' || parsed.action === 'book')) {
      baseAction = parsed;
      break;
    }
  }

  if (!baseAction || (baseAction.action !== 'search' && baseAction.action !== 'book')) {
    return null;
  }

  if (baseAction.action === 'book') {
    const baseParams = baseAction.params;
    const date = hintedDate ?? baseParams.date;
    const startTime = hintedStartTime ?? baseParams.startTime;
    const duration = hintedDuration ?? baseParams.duration;
    const numberOfPeople = hintedPeople ?? baseParams.numberOfPeople;
    if (!date || !startTime) {
      return null;
    }

    return {
      action: 'book',
      params: {
        roomName: hintedRoomName ?? baseParams.roomName,
        numberOfPeople,
        date,
        startTime,
        duration,
      },
    };
  }

  const baseParams = baseAction.params;
  const date = hintedDate ?? baseParams.date;
  const startTime = hintedStartTime ?? baseParams.startTime;
  const duration = hintedDuration ?? baseParams.duration;
  const numberOfPeople = hintedPeople ?? baseParams.numberOfPeople;
  if (!date || !startTime) {
    return null;
  }

  return {
    action: 'search',
    params: {
      numberOfPeople,
      date,
      startTime,
      duration,
    },
  };
}

function buildSystemPrompt(): string {
  const now = vnNow();
  const roomsInfo = config.rooms
    .map((room) => {
      const floor = room.floor !== undefined ? `, tầng ${room.floor}` : '';
      const equipment = room.equipment?.length ? room.equipment.slice(0, 3).join(', ') : 'chưa có dữ liệu';
      return `- ${room.name}: tối đa ${room.capacity} người${floor}, thiết bị: ${equipment} (id: ${room.id})`;
    })
    .join('\n');

  return `Bạn là trợ lý booking phòng họp cho Apero.
Thời gian chuẩn để hiểu ngày/giờ là UTC+7. Hôm nay là ${toIsoDate(now)}, hiện tại ${now.toISOString().slice(11, 16)} (UTC+7).

Danh sách phòng hiện có:
${roomsInfo}

Bạn PHẢI trả về DUY NHẤT 1 JSON hợp lệ, không markdown, không text ngoài JSON:
{
  "action": "search|book|check_booking|check_room_schedule|list_rooms|clarify|info",
  "message": "tiếng Việt tự nhiên, ngắn gọn, đúng trọng tâm",
  "params": {
    "roomName": "...",
    "numberOfPeople": 1,
    "date": "YYYY-MM-DD",
    "startTime": "HH:mm",
    "duration": 60,
    "month": 4,
    "year": 2026
  }
}

Quy tắc intent:
- Đặt phòng => action=book.
- Tìm phòng trống hoặc hỏi gợi ý phòng theo thời điểm => action=search.
- Xem lịch của phòng => action=check_room_schedule.
- Xem booking của chính user => action=check_booking.

Quy tắc thời gian (bắt buộc):
- Nếu user nêu thứ/ngày cụ thể thì phải giữ đúng thứ/ngày đó trong params.date.
- Tuyệt đối không tự đổi sang ngày khác (ví dụ user nói thứ 5 thì không được chuyển chủ nhật).
- Nếu user chỉ nêu thứ (chưa có ngày), quy đổi sang ngày gần nhất sắp tới theo UTC+7.
- Có "tuần sau/next week" thì đẩy sang tuần kế tiếp.
- Không chắc ngày hoặc giờ => action=clarify, hỏi đúng phần còn thiếu, không đoán.

Quy tắc gợi ý:
- Nếu user hỏi gợi ý/đề xuất phòng, câu trả lời phải nêu phòng cụ thể từ danh sách phòng.
- Nếu user chưa nêu đủ ngày hoặc giờ, dùng action=clarify và message phải:
  1) hỏi đúng trường còn thiếu,
  2) kèm gợi ý ngắn (2-3 phòng phù hợp).

Quy tắc chất lượng:
- numberOfPeople mặc định 1, duration mặc định 60.
- Không bịa dữ liệu phòng ngoài danh sách.
- Ưu tiên đúng trọng tâm booking hơn giải thích dài dòng.`;
}

function coerceAiResponse(raw: unknown, fallback: AIResponse | null, sourceMessage: string): AIResponse | null {
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }

  const payload = raw as Record<string, unknown>;
  const action = typeof payload.action === 'string' ? payload.action : '';
  const message = typeof payload.message === 'string' && payload.message.trim() ? payload.message.trim() : undefined;
  const params = (payload.params && typeof payload.params === 'object' ? payload.params : {}) as Record<string, unknown>;
  const fallbackBookingParams:
    | { roomName?: string; numberOfPeople?: number; date?: string; startTime?: string; duration?: number }
    | undefined =
    fallback && (fallback.action === 'search' || fallback.action === 'book')
      ? (fallback.params as { roomName?: string; numberOfPeople?: number; date?: string; startTime?: string; duration?: number })
      : undefined;
  const hintedDate = resolveRelativeDate(sourceMessage);
  const hintedStartTime = resolveTime(sourceMessage);
  const hintedDuration = resolveDurationHint(sourceMessage);
  const hintedPeople = resolvePeopleHint(sourceMessage);
  const hintedRoomName = resolveRoomName(sourceMessage);

  if (action === 'list_rooms') {
    return { action: 'list_rooms', message: message ?? 'Mình sẽ hiển thị danh sách phòng hiện có.' };
  }
  if (action === 'check_booking') {
    return { action: 'check_booking', message: message ?? 'Mình sẽ kiểm tra lịch của bạn.' };
  }
  if (action === 'check_room_schedule') {
    return {
      action: 'check_room_schedule',
      params: {
        roomName: typeof params.roomName === 'string' ? params.roomName : undefined,
        month: typeof params.month === 'number' ? params.month : undefined,
        year: typeof params.year === 'number' ? params.year : undefined,
      },
      message: message ?? 'Mình sẽ kiểm tra lịch của phòng.',
    };
  }
  if (action === 'clarify') {
    return { action: 'clarify', message: message ?? 'Bạn có thể nói rõ thêm ngày và giờ được không?' };
  }
  if (action === 'info') {
    return { action: 'info', message: message ?? 'Mình có thể giúp bạn tìm phòng, đặt phòng hoặc kiểm tra lịch.' };
  }
  if (action === 'search' || action === 'book') {
    if (fallback?.action === 'clarify' && (!hintedDate || !hintedStartTime)) {
      return fallback;
    }

    const bookingAction: 'search' | 'book' = action === 'search' ? 'search' : 'book';
    const hasDateEvidence = typeof hintedDate === 'string' || typeof fallbackBookingParams?.date === 'string';
    const hasStartTimeEvidence = typeof hintedStartTime === 'string' || typeof fallbackBookingParams?.startTime === 'string';

    if (!hasDateEvidence || !hasStartTimeEvidence) {
      return fallback ?? { action: 'clarify', message: 'Bạn cho mình ngày và giờ cụ thể để mình tìm phòng chính xác nhé.' };
    }

    const date =
      typeof hintedDate === 'string'
        ? hintedDate
        : typeof params.date === 'string'
        ? params.date
        : typeof fallbackBookingParams?.date === 'string'
          ? fallbackBookingParams.date
          : undefined;
    const startTime =
      typeof hintedStartTime === 'string'
        ? hintedStartTime
        : typeof params.startTime === 'string'
        ? params.startTime
        : typeof fallbackBookingParams?.startTime === 'string'
          ? fallbackBookingParams.startTime
          : undefined;
    if (!date || !startTime) {
      return fallback ?? { action: 'clarify', message: 'Bạn muốn đặt phòng vào ngày nào và lúc mấy giờ?' };
    }
    const numberOfPeople =
      typeof hintedPeople === 'number'
        ? hintedPeople
        : typeof params.numberOfPeople === 'number'
        ? params.numberOfPeople
        : typeof fallbackBookingParams?.numberOfPeople === 'number'
          ? fallbackBookingParams.numberOfPeople
          : 1;
    const duration =
      typeof hintedDuration === 'number'
        ? hintedDuration
        : typeof params.duration === 'number'
        ? params.duration
        : typeof fallbackBookingParams?.duration === 'number'
          ? fallbackBookingParams.duration
          : 60;
    const roomName =
      typeof hintedRoomName === 'string'
        ? hintedRoomName
        : typeof params.roomName === 'string'
        ? params.roomName
        : typeof fallbackBookingParams?.roomName === 'string'
          ? fallbackBookingParams.roomName
          : undefined;

    if (bookingAction === 'search') {
      return {
        action: 'search',
        params: {
          numberOfPeople,
          date,
          startTime,
          duration,
        },
      };
    }

    return {
      action: 'book',
      params: {
        roomName,
        numberOfPeople,
        date,
        startTime,
        duration,
      },
    };
  }

  return fallback;
}

export async function processChat(message: string, conversationHistory: ChatMessage[] = []): Promise<AIResponse> {
  const fallback = parseCommonCommand(message) ?? buildContextualBookingFollowup(message, conversationHistory);
  const normalizedInput = normalizeText(message);

  if (config.openaiApiKey) {
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
        temperature: 0.3,
        max_tokens: 500,
      });

      const content = completion.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content) as unknown;
        const coerced = coerceAiResponse(parsed, fallback, message);
        if (coerced) {
          const shouldPreferFallbackFromIntent =
            fallback &&
            (fallback.action === 'book' || fallback.action === 'search' || fallback.action === 'check_room_schedule') &&
            (coerced.action === 'clarify' || coerced.action === 'info');
          const shouldPreferFallbackBookingAction =
            fallback && fallback.action === 'book' && hasBookIntent(normalizedInput) && coerced.action === 'search';

          if (shouldPreferFallbackFromIntent || shouldPreferFallbackBookingAction) {
            return fallback;
          }
          return coerced;
        }
      }
    } catch (error) {
      console.error('AI service error:', error);
    }
  }

  if (fallback) {
    return fallback;
  }

  return {
    action: 'clarify',
    message: 'Mình chưa bắt được ý chính. Bạn muốn tìm phòng trống, đặt phòng hay kiểm tra lịch?',
  };
}
