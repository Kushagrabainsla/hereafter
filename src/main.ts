import "./style.css";
import { arenaFromUrl } from "./world/arena";
import { createMapViewer, type MapViewer, type MapState } from "./world/mapViewer";
import { newRoomCode, normalizeRoomCode, PeerRoom } from "./network/peerRoom";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
}

const controlsDialog = element<HTMLDialogElement>("controls-dialog");
const openControlsButton = element<HTMLButtonElement>("open-controls");
const closeControlsButton = element<HTMLButtonElement>("close-controls");
const roomDialog = element<HTMLDialogElement>("room-dialog");
const openRoomButton = element<HTMLButtonElement>("open-room");
const closeRoomButton = element<HTMLButtonElement>("close-room");
const createRoomButton = element<HTMLButtonElement>("create-room");
const joinRoomButton = element<HTMLButtonElement>("join-room");
const leaveRoomButton = element<HTMLButtonElement>("leave-room");
const copyInviteButton = element<HTMLButtonElement>("copy-invite");
const roomEntry = element<HTMLElement>("room-entry");
const roomActive = element<HTMLElement>("room-active");
const roomCodeInput = element<HTMLInputElement>("room-code");
const activeRoomCode = element<HTMLElement>("active-room-code");
const inviteLink = element<HTMLInputElement>("invite-link");
const roomStatus = element<HTMLElement>("room-status");
const performanceLabel = element<HTMLElement>("performance");
const notice = element<HTMLElement>("notice");
const noticeLabel = element<HTMLElement>("notice-label");
const noticeMessage = element<HTMLElement>("notice-message");
let viewer: MapViewer | null = null;
let peerRoom: PeerRoom | null = null;
const arena = arenaFromUrl(window.location.search);

function setStatus(state: MapState, message: string): void {
  notice.dataset.state = state;
  notice.hidden = state === "ready";
  noticeLabel.textContent = state === "error" ? "Arena unavailable" : "Preparing arena";
  noticeMessage.textContent = message;
}

function openControls(): void {
  if (controlsDialog.open || roomDialog.open) return;
  controlsDialog.showModal();
  syncPause();
}

function closeControls(): void {
  if (controlsDialog.open) controlsDialog.close();
}

function syncPause(): void {
  viewer?.setPaused(controlsDialog.open || roomDialog.open);
}

function openRoom(): void {
  if (roomDialog.open || controlsDialog.open) return;
  roomDialog.showModal();
  syncPause();
}

function roomLink(code: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("room", code);
  return url.toString();
}

function enterRoom(rawCode: string): void {
  if (peerRoom) return;
  const code = normalizeRoomCode(rawCode);
  if (code.length < 6 || code.length > 24) {
    roomStatus.textContent = "Enter a room code with 6–24 letters or numbers.";
    return;
  }
  try {
    peerRoom = new PeerRoom(code, arena, {
      onPeers(count, spawnSlot) {
        openRoomButton.textContent = count === 1 ? "Room · waiting" : `Room · ${count} players`;
        viewer?.setSpawnSlot(spawnSlot);
      },
      onPose(peerId, pose) {
        viewer?.setRemotePose(peerId, pose);
      },
      onPeerLeave(peerId) {
        viewer?.removeRemotePeer(peerId);
      },
      onStatus(message) {
        roomStatus.textContent = message;
      },
    });
    roomCodeInput.value = code;
    activeRoomCode.textContent = code;
    inviteLink.value = roomLink(code);
    roomEntry.hidden = true;
    roomActive.hidden = false;
    window.history.replaceState(null, "", inviteLink.value);
  } catch {
    roomStatus.textContent = "Could not open the room. Please try again.";
  }
}

async function leaveRoom(): Promise<void> {
  const leaving = peerRoom;
  peerRoom = null;
  viewer?.clearRemotePeers();
  viewer?.setSpawnSlot(0);
  roomEntry.hidden = false;
  roomActive.hidden = true;
  roomStatus.textContent = "Room left. You can still explore on your own.";
  openRoomButton.textContent = "Play together";
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState(null, "", url);
  if (leaving) await leaving.leave();
}

openControlsButton.addEventListener("click", openControls);
closeControlsButton.addEventListener("click", closeControls);
controlsDialog.addEventListener("close", syncPause);
openRoomButton.addEventListener("click", openRoom);
closeRoomButton.addEventListener("click", () => roomDialog.close());
roomDialog.addEventListener("close", syncPause);
createRoomButton.addEventListener("click", () => enterRoom(newRoomCode()));
joinRoomButton.addEventListener("click", () => enterRoom(roomCodeInput.value));
roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") enterRoom(roomCodeInput.value);
});
leaveRoomButton.addEventListener("click", () => { void leaveRoom(); });
copyInviteButton.addEventListener("click", () => {
  if (!navigator.clipboard) {
    inviteLink.select();
    roomStatus.textContent = "Copy is unavailable. Select and copy the link above.";
    return;
  }
  void navigator.clipboard.writeText(inviteLink.value).then(() => {
    roomStatus.textContent = "Invite link copied. Share it with a friend.";
  }).catch(() => {
    inviteLink.select();
    roomStatus.textContent = "Copy is unavailable. Select and copy the link above.";
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "h" || event.repeat || event.altKey || event.metaKey || event.ctrlKey || roomDialog.open) return;
  event.preventDefault();
  if (controlsDialog.open) closeControls();
  else openControls();
});

window.setInterval(() => {
  if (viewer && peerRoom) peerRoom.sendPose(viewer.playerPose());
}, 100);
window.addEventListener("beforeunload", () => { void peerRoom?.leave(); });

void createMapViewer(element("map"), arena, {
  onStatus: setStatus,
  onMetrics(metrics) {
    performanceLabel.textContent = `${metrics.renderer} · ${metrics.fps} FPS`;
  },
}).then((created) => {
  viewer = created;
  syncPause();
  const invite = new URLSearchParams(window.location.search).get("room");
  if (invite) enterRoom(invite);
}).catch(() => {
  setStatus("error", "The world could not load. Check browser WebGPU or WebGL 2 support, then reload.");
  performanceLabel.textContent = "Graphics unavailable";
});
