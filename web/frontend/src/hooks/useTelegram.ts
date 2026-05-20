import { isMiniApp, getInitData } from "../utils/telegram";

export function useTelegram() {
  return {
    isMiniApp: isMiniApp(),
    initData: getInitData(),
  };
}
