/**
 * 營業時間：06:00–22:00，每小時一檔（最後一檔 21:00–22:00）
 */
export const BUSINESS_HOURS = {
  start: 6,
  end: 22,
  intervalMinutes: 60,
} as const;

export function getAvailableTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = BUSINESS_HOURS.start; h < BUSINESS_HOURS.end; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
  }
  return slots;
}

export const SERVICE_DURATION: Record<string, number> = {
  '體驗課程': 1,
  '1對1教學': 1,
  '下場實戰教學': 5,
  '果嶺邊實戰教學': 2,
};

export const LOCATION_MAP: Record<string, string> = {
  '桃園良益高爾夫練習場': 'https://www.google.com/maps/search/?api=1&query=桃園+良益高爾夫練習場',
  '桃園亞洲高爾夫練習場': 'https://www.google.com/maps/search/?api=1&query=桃園+亞洲高爾夫練習場',
  '桃園清浦高爾夫練習場': 'https://www.google.com/maps/search/?api=1&query=桃園+清浦高爾夫練習場',
  '新竹東海櫻花高爾夫練習場': 'https://www.google.com/maps/search/?api=1&query=新竹+東海櫻花高爾夫練習場',
};
