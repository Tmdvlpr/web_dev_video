import { isMiniApp, getInitData, getInviteParam } from "../utils/telegram";

export function useTelegram() {
  return {
    isMiniApp: isMiniApp(),
    initData: getInitData(),
    inviteParam: getInviteParam(),
  };
}
