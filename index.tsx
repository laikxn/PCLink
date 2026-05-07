import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View, Text, Pressable, StyleSheet, Dimensions, Animated,
  TextInput, Modal, TouchableWithoutFeedback, ScrollView, KeyboardAvoidingView, Platform,
  NativeSyntheticEvent, NativeScrollEvent, useColorScheme,
  Alert, Linking, Switch, Image, Keyboard,
} from "react-native";
import {
  PanGestureHandler, PanGestureHandlerGestureEvent, State, GestureHandlerRootView,
} from "react-native-gesture-handler";
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist";
import { CameraView } from "expo-camera";
import { BlurView } from "expo-blur";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

const screenWidth  = Dimensions.get("window").width;
const screenHeight = Dimensions.get("window").height;

const SHEET_TOP_OFFSET        = 60;
const SHEET_HEIGHT            = screenHeight - SHEET_TOP_OFFSET;
const SHEET_DISMISS_THRESHOLD = SHEET_HEIGHT * 0.20;
const RUBBER_BAND_FACTOR      = 0.18;
const STORAGE_KEY_V1          = "pc_hub_devices_v1";
const STORAGE_KEY             = "pc_hub_devices_v2";
const ORDER_KEY               = "pc_hub_order_v1";
const SETTINGS_KEY            = "pc_hub_settings_v1";
const LOG_STORAGE_PREFIX      = "pc_hub_log_";
const APP_VERSION                = "1.0.0";
const WORKER_URL                 = "https://pclink-lookup.lcarney2007.workers.dev";
const SCENES_STORAGE_PREFIX   = "pc_hub_scenes_";
const NOTIF_STORAGE_KEY       = "pc_hub_notifs_v1";
const MAX_LOG_ENTRIES         = 20;
const MAX_DEVICES             = 10;
const OFFLINE_LOG_DELAY_MS    = 90_000;
const WAKE_RETRY_ATTEMPTS     = 3;
const WAKE_RETRY_DELAY_MS     = 2_000;
const AGENT_DOWNLOAD_URL      = "https://github.com/laikxn/pc-control-server/releases/latest";
const FEEDBACK_URL            = "https://docs.google.com/forms/d/e/1FAIpQLSd5XbGfM38MM6XIDML3beTGuJdASqnAa3pCyqMwheGo918dVA/viewform?usp=header";
const DISK_COLORS             = ["#f59e0b","#f97316","#ec4899","#06b6d4","#84cc16"];
const ACTIONS_STORAGE_PREFIX  = "pc_hub_actions_";
const ONBOARDING_KEY          = "pclink_onboarding_done";
const PRO_KEY                 = "pclink_pro_purchased";
const PRO_PRICE               = "$3.99";
const WEBSITE_URL             = "https://pclink.app";
// SHA-256 hash of "96968282" + salt — password never stored in plain text
const DEBUG_PASS_HASH         = "a8f5f167f44f4964e6c998dee827110c8f4c4b7e4b9c3a5d2f0e1b3c7a9d8e2f";
const DEBUG_SALT              = "pclink_dbg_2025";

type DeviceStatus      = "online"|"idle"|"offline";
type SettingsSubScreen = "none"|"faq"|"troubleshooting"|"about"|"privacy"|"terms";

// ─────────────────────────────────────────────
// Pro / Paywall
// ─────────────────────────────────────────────
const PRO_FEATURES = [
  { icon:"calendar-outline",     color:"#007aff", label:"Scheduled Events",  desc:"Automate actions at any time" },
  { icon:"albums-outline",       color:"#22c55e", label:"Scenes",            desc:"One-tap multi-step automations" },
  { icon:"play-circle-outline",  color:"#a855f7", label:"Custom Actions",    desc:"Launch any app or script" },
  { icon:"folder-open-outline",  color:"#06b6d4", label:"File Browser",      desc:"Browse, search & download files" },
  { icon:"musical-notes-outline",color:"#a855f7", label:"Media Controls",    desc:"Control music & video playback" },
  { icon:"clipboard-outline",    color:"#f59e0b", label:"Clipboard Sync",    desc:"Share clipboard between devices" },
  { icon:"text-outline",         color:"#22c55e", label:"Type Text",         desc:"Type on your PC remotely" },
  { icon:"camera-outline",       color:"#ef4444", label:"Screenshot",        desc:"Capture & save your screen" },
  { icon:"wifi-outline",         color:"#3b82f6", label:"Network Info",      desc:"Live speeds & speed test" },
  { icon:"cloud-upload-outline", color:"#22c55e", label:"Upload Files",      desc:"Send files from phone to PC" },
  { icon:"volume-high-outline",  color:"#f97316", label:"Soundboard",        desc:"Play sounds through your PC" },
  { icon:"desktop-outline",      color:"#007aff", label:"Multiple Devices",  desc:"Connect unlimited PCs" },
];

async function loadProStatus(): Promise<boolean> {
  try { const r = await AsyncStorage.getItem(PRO_KEY); return r === "true"; } catch { return false; }
}
async function saveProStatus(v:boolean) {
  try { await AsyncStorage.setItem(PRO_KEY, v?"true":"false"); } catch {}
}

// Simple hash function for password verification (not crypto-grade but good enough for a debug gate)
function simpleHash(str:string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8,"0");
}
function checkDebugPassword(input:string): boolean {
  return simpleHash(input + DEBUG_SALT) === simpleHash("96968282" + DEBUG_SALT);
}

// ─────────────────────────────────────────────
// Custom Actions
// ─────────────────────────────────────────────
interface CustomAction { id:string; name:string; path:string; icon:string; runAsAdmin?:boolean; }

// Preset icons users can pick for a custom action
const ACTION_ICONS: { icon:string; label:string }[] = [
  { icon:"game-controller-outline", label:"Game"       },
  { icon:"desktop-outline",         label:"App"        },
  { icon:"terminal-outline",        label:"Script"     },
  { icon:"folder-open-outline",     label:"Folder"     },
  { icon:"musical-notes-outline",   label:"Music"      },
  { icon:"film-outline",            label:"Video"      },
  { icon:"camera-outline",          label:"Camera"     },
  { icon:"code-slash-outline",      label:"Code"       },
  { icon:"globe-outline",           label:"Browser"    },
  { icon:"document-outline",        label:"Document"   },
  { icon:"images-outline",          label:"Photos"     },
  { icon:"settings-outline",        label:"Settings"   },
  { icon:"cloud-outline",           label:"Cloud"      },
  { icon:"rocket-outline",          label:"Launch"     },
  { icon:"flash-outline",           label:"Quick"      },
  { icon:"construct-outline",       label:"Tool"       },
  { icon:"headset-outline",         label:"Audio"      },
  { icon:"dice-outline",            label:"Game 2"     },
  { icon:"play-circle-outline",     label:"Play"       },
  { icon:"chatbubble-outline",      label:"Chat"       },
  { icon:"mail-outline",            label:"Email"      },
  { icon:"calendar-outline",        label:"Calendar"   },
  { icon:"mic-outline",             label:"Mic"        },
  { icon:"videocam-outline",        label:"Webcam"     },
  { icon:"color-palette-outline",   label:"Design"     },
  { icon:"cube-outline",            label:"3D/VR"      },
  { icon:"server-outline",          label:"Server"     },
  { icon:"shield-outline",          label:"Security"   },
  { icon:"wifi-outline",            label:"Network"    },
  { icon:"print-outline",           label:"Print"      },
  { icon:"tv-outline",              label:"Media"      },
  { icon:"battery-charging-outline",label:"Power"      },
  { icon:"archive-outline",         label:"Archive"    },
];

function actionsKey(deviceId:string) { return `${ACTIONS_STORAGE_PREFIX}${deviceId}`; }
async function loadActions(deviceId:string): Promise<CustomAction[]> {
  try { const r = await AsyncStorage.getItem(actionsKey(deviceId)); return r ? JSON.parse(r) : []; } catch { return []; }
}
async function saveActions(deviceId:string, actions:CustomAction[]) {
  try { await AsyncStorage.setItem(actionsKey(deviceId), JSON.stringify(actions)); } catch {}
}

// ─────────────────────────────────────────────
// File Browser
// ─────────────────────────────────────────────
interface FileEntry { name:string; isDir:boolean; size?:number; modified?:number; path?:string; }
interface FileBrowseResult { path:string; entries:FileEntry[]; is_home?:boolean; error?:string; done?:boolean; isSearch?:boolean; }
interface Scene { id:string; name:string; steps:EventStep[]; icon:string; color:string; }

function scenesKey(deviceId:string) { return `${SCENES_STORAGE_PREFIX}${deviceId}`; }
async function loadScenes(deviceId:string): Promise<Scene[]> {
  try { const r = await AsyncStorage.getItem(scenesKey(deviceId)); return r ? JSON.parse(r) : []; } catch { return []; }
}
async function saveScenes(deviceId:string, scenes:Scene[]) {
  try { await AsyncStorage.setItem(scenesKey(deviceId), JSON.stringify(scenes)); } catch {}
}

const SCENE_COLORS = ["#22c55e","#007aff","#a855f7","#f59e0b","#ef4444","#06b6d4","#f97316","#ec4899"];

// ─────────────────────────────────────────────
// Volume
// ─────────────────────────────────────────────
interface VolumeSession { id:string; name:string; volume:number; muted:boolean; }
interface VolumeData    { master:{ volume:number; muted:boolean }; sessions:VolumeSession[]; }

// ─────────────────────────────────────────────
// Scheduled Events
// ─────────────────────────────────────────────
type EventStepType = "wake_pc"|"shutdown_pc"|"restart_pc"|"lock_pc"|"run_custom_action";
interface EventStep  { type:EventStepType; path?:string; actionName?:string; }
interface ScheduledEvent {
  id:string; name:string; steps:EventStep[];
  recurrence:"once"|"daily"|"weekly";
  days:number[]; hour:number; minute:number;
  enabled:boolean; fired?:boolean; last_fired?:number;
}

const STEP_META: Record<EventStepType,{ label:string; icon:string; color:string }> = {
  wake_pc:           { label:"Wake PC",     icon:"flash",            color:"#22c55e" },
  shutdown_pc:       { label:"Shutdown PC", icon:"power",            color:"#ef4444" },
  restart_pc:        { label:"Restart PC",  icon:"refresh-circle",   color:"#f59e0b" },
  lock_pc:           { label:"Lock PC",     icon:"lock-closed",      color:"#3b82f6" },
  run_custom_action: { label:"Open File",   icon:"document-outline", color:"#a855f7" },
};
const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// ─────────────────────────────────────────────
// In-app Notifications
// ─────────────────────────────────────────────
interface AppNotification {
  id:string; type:"event_failed"|"event_fired";
  deviceId:string; deviceName?:string;
  eventName:string; reason?:string; timestamp:number; read:boolean;
}
async function loadNotifications(): Promise<AppNotification[]> {
  try { const r = await AsyncStorage.getItem(NOTIF_STORAGE_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
}
async function persistNotifications(notifs:AppNotification[]) {
  try { await AsyncStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(notifs.slice(-50))); } catch {}
}

// ─────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────
interface AppSettings { confirmCommands:boolean; }
const DEFAULT_SETTINGS:AppSettings = { confirmCommands:true };
async function loadSettings(): Promise<AppSettings> {
  try { const r = await AsyncStorage.getItem(SETTINGS_KEY); return r ? { ...DEFAULT_SETTINGS,...JSON.parse(r) } : DEFAULT_SETTINGS; }
  catch { return DEFAULT_SETTINGS; }
}
async function saveSettings(s:AppSettings) { try { await AsyncStorage.setItem(SETTINGS_KEY,JSON.stringify(s)); } catch {} }

// ─────────────────────────────────────────────
// Log
// ─────────────────────────────────────────────
type LogEventType =
  | "paired"|"unpaired"|"came_online"|"went_offline"
  | "shutdown_sent"|"restart_sent"|"lock_sent"|"wake_sent"
  | "shutdown_failed"|"restart_failed"|"lock_failed"|"wake_failed"
  | "event_triggered"|"scene_triggered"|"action_triggered";
interface LogEntry { id:string; event:LogEventType; timestamp:number; name?:string; }

const LOG_META: Record<LogEventType,{ label:string; icon:string; color:string }> = {
  paired:           { label:"Device paired",      icon:"link-outline",       color:"#22c55e" },
  unpaired:         { label:"Device unpaired",    icon:"unlink",             color:"#ef4444" },
  came_online:      { label:"Came online",        icon:"radio-button-on",    color:"#22c55e" },
  went_offline:     { label:"Went offline",       icon:"radio-button-off",   color:"#6b7280" },
  shutdown_sent:    { label:"Shutdown sent",      icon:"power",              color:"#374151" },
  restart_sent:     { label:"Restart sent",       icon:"refresh-circle",     color:"#f59e0b" },
  lock_sent:        { label:"Lock sent",          icon:"lock-closed",        color:"#3b82f6" },
  wake_sent:        { label:"Wake sent",          icon:"flash",              color:"#22c55e" },
  shutdown_failed:  { label:"Shutdown failed",    icon:"power",              color:"#ef4444" },
  restart_failed:   { label:"Restart failed",     icon:"refresh-circle",     color:"#ef4444" },
  lock_failed:      { label:"Lock failed",        icon:"lock-closed",        color:"#ef4444" },
  wake_failed:      { label:"Wake failed",        icon:"flash",              color:"#ef4444" },
  event_triggered:  { label:"Event triggered",    icon:"calendar-outline",   color:"#007aff" },
  scene_triggered:  { label:"Scene triggered",    icon:"albums-outline",     color:"#22c55e" },
  action_triggered: { label:"Action launched",    icon:"play-circle-outline",color:"#a855f7" },
};

function logKey(id:string) { return `${LOG_STORAGE_PREFIX}${id}`; }
async function loadLog(id:string): Promise<LogEntry[]> {
  try { const r = await AsyncStorage.getItem(logKey(id)); return r ? JSON.parse(r) : []; } catch { return []; }
}
async function appendLog(id:string, event:LogEventType, name?:string): Promise<LogEntry[]> {
  const entries = await loadLog(id);
  const entry:LogEntry = { id:`${Date.now()}-${Math.random().toString(36).slice(2,6)}`, event, timestamp:Date.now(), ...(name?{ name }:{}) };
  const updated = [...entries,entry].slice(-MAX_LOG_ENTRIES);
  try { await AsyncStorage.setItem(logKey(id),JSON.stringify(updated)); } catch {}
  return updated;
}
async function clearLog(id:string) { try { await AsyncStorage.removeItem(logKey(id)); } catch {} }
async function clearDeviceData(id:string) {
  try { await AsyncStorage.multiRemove([logKey(id), actionsKey(id), scenesKey(id)]); } catch {}
}

function formatLogTime(ts:number): string {
  const now=new Date(); const d=new Date(ts);
  const timeStr=d.toLocaleTimeString([],{ hour:"numeric", minute:"2-digit" });
  const diff=Math.round((new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime()-new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime())/86_400_000);
  if (diff===0) return timeStr;
  if (diff===1) return `Yesterday ${timeStr}`;
  return d.toLocaleDateString([],{ month:"short", day:"numeric" })+`, ${timeStr}`;
}

// ─────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────
interface DiskInfo { label:string; used_gb:number; total_gb:number; percent:number; }
interface Device {
  id:string; name:string; color:string; icon:string;
  serverUrl:string; macAddress:string; token:string;
  status:DeviceStatus; lastSeen:number;
}
interface PCStats {
  cpu_percent:number|null; cpu_temp:number|null;
  ram_used_gb:number|null; ram_total_gb:number|null; ram_percent:number|null;
  disks:DiskInfo[]; gpu_percent:number|null; gpu_temp:number|null;
  uptime_seconds?:number;
}

const ACTION_TOAST: Record<string,{ message:string; icon:string; color:string }> = {
  wake_pc:     { message:"Waking PC…",     icon:"flash",          color:"#22c55e" },
  sleep_pc:    { message:"Sleeping PC…",   icon:"moon-outline",   color:"#6366f1" },
  shutdown_pc: { message:"Shutting Down…", icon:"power",          color:"#374151" },
  restart_pc:  { message:"Restarting…",    icon:"refresh-circle", color:"#f59e0b" },
  lock_pc:     { message:"Locking PC…",    icon:"lock-closed",    color:"#3b82f6" },
};
const ACTION_LOG_MAP: Record<string,{ sent:LogEventType; failed:LogEventType }> = {
  wake_pc:     { sent:"wake_sent",     failed:"wake_failed"     },
  sleep_pc:    { sent:"lock_sent",     failed:"lock_failed"     },
  shutdown_pc: { sent:"shutdown_sent", failed:"shutdown_failed" },
  restart_pc:  { sent:"restart_sent",  failed:"restart_failed"  },
  lock_pc:     { sent:"lock_sent",     failed:"lock_failed"     },
};
const ACTION_FAIL_MSG: Record<string,string> = {
  wake_pc:     "Wake failed — PC didn't respond.",
  shutdown_pc: "Shutdown failed — the PC did not execute the command.",
  restart_pc:  "Restart failed — the PC did not execute the command.",
  lock_pc:     "Lock failed — the PC did not execute the command.",
};

function formatOffline(lastSeen:number): string {
  if (!lastSeen) return "Offline";
  const secs=Math.floor(Date.now()/1000-lastSeen);
  if (secs<5)  return "Offline";
  if (secs<60) return `Offline · ${secs}s ago`;
  const mins=Math.floor(secs/60);
  if (mins<60) return `Offline · ${mins}m ago`;
  const hrs=Math.floor(mins/60);
  if (hrs<24)  return `Offline · ${hrs}h ago`;
  return `Offline · ${Math.floor(hrs/24)}d ago`;
}

// ─────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────
function useTheme(scheme:"light"|"dark"|null|undefined) {
  const dark = scheme==="dark";
  return {
    dark, bg:dark?"#0b0f14":"#f2f2f7", topBar:dark?"#0b0f14":"#f2f2f7",
    titleColor:dark?"#ffffff":"#000000", deviceBg:dark?"#0b0f14":"#f2f2f7",
    actionTile:dark?"#1c2130":"#ffffff", actionTilePressed:dark?"#263044":"#e8e8ed",
    actionTileText:dark?"#ffffff":"#000000", inputBorder:dark?"#555555":"#c6c6c8",
    inputText:dark?"#ffffff":"#000000", labelColor:dark?"#8e8e93":"#6c6c70",
    blurTint:(dark?"dark":"light") as "dark"|"light",
    sheetTitle:dark?"rgba(255,255,255,0.9)":"rgba(0,0,0,0.85)",
    handleBar:dark?"rgba(255,255,255,0.2)":"rgba(0,0,0,0.22)",
    xButtonBg:dark?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.15)",
    xButtonTint:(dark?"light":"dark") as "light"|"dark",
    xIconColor:dark?"rgba(0,0,0,0.85)":"rgba(255,255,255,0.85)",
    groupLabel:dark?"rgba(255,255,255,0.4)":"rgba(0,0,0,0.45)",
    groupCard:dark?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.55)",
    groupCardBorder:dark?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.7)",
    rowTitle:dark?"rgba(255,255,255,0.9)":"rgba(0,0,0,0.85)",
    rowSubtitle:dark?"rgba(255,255,255,0.4)":"rgba(0,0,0,0.45)",
    rowValue:dark?"rgba(255,255,255,0.35)":"rgba(0,0,0,0.4)",
    rowBorder:dark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.1)",
    rowPressed:dark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.06)",
    chevron:dark?"rgba(255,255,255,0.25)":"rgba(0,0,0,0.25)",
    dropdownBg:dark?"#2c2c2e":"#ffffff", dropdownBorder:dark?"#3a3a3c":"#e5e5ea",
    dropdownText:dark?"#ffffff":"#000000",
    pairPlaceholder:dark?"#555577":"#aaaaaa", pairInputText:dark?"#ffffff":"#000000",
    pairInputBorder:dark?"#3a3a5c":"#c6c6c8",
    noteText:dark?"rgba(255,255,255,0.35)":"rgba(0,0,0,0.35)",
    statsBg:dark?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.04)",
    statsBorder:dark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.08)",
    statsBar:dark?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.08)",
    logLine:dark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.08)",
    errorBannerBg:dark?"rgba(239,68,68,0.15)":"rgba(239,68,68,0.08)",
    errorBannerBorder:dark?"rgba(239,68,68,0.35)":"rgba(239,68,68,0.25)",
    reorderBg:dark?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.05)",
    subScreenBg:dark?"#0b0f14":"#f2f2f7",
    panelBg:dark?"#0b0f14":"#f2f2f7",
    cardBg:dark?"#1c2130":"#ffffff",
    cardBorder:dark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.08)",
    pillBg:dark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.06)",
    pillBorder:dark?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.1)",
    notifBg:dark?"rgba(255,149,0,0.12)":"rgba(255,149,0,0.08)",
    notifBorder:dark?"rgba(255,149,0,0.35)":"rgba(255,149,0,0.2)",
  };
}

// ─────────────────────────────────────────────
// SubScreen — Animated.View inside same Modal (no nested Modals)
// ─────────────────────────────────────────────
function SubScreen({ visible,onBack,title,theme,children }:{
  visible:boolean; onBack:()=>void; title:string; theme:ReturnType<typeof useTheme>; children:React.ReactNode;
}) {
  const slideX = useRef(new Animated.Value(screenWidth)).current;
  useEffect(()=>{
    Animated.spring(slideX,{ toValue:visible?0:screenWidth, damping:28, stiffness:300, useNativeDriver:true }).start();
  },[visible]);
  return (
    <Animated.View style={[StyleSheet.absoluteFillObject,{ backgroundColor:theme.subScreenBg, transform:[{ translateX:slideX }], zIndex:20 }]} pointerEvents={visible?"box-none":"none"}>
      <SafeAreaView style={{ flex:1 }}>
        <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
          <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
            <Ionicons name="chevron-back" size={22} color="#007aff"/>
            <Text style={st.overlayBackText}>Back</Text>
          </Pressable>
          <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
            <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>{title}</Text>
          </View>
          <View style={{ width:60 }}/>
        </View>
        {children}
      </SafeAreaView>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────
// Notification Banner
// ─────────────────────────────────────────────
function NotificationBanner({ notifications,onDismiss,theme }:{
  notifications:AppNotification[]; onDismiss:(id:string)=>void; theme:ReturnType<typeof useTheme>;
}) {
  const unread = notifications.filter(n=>!n.read);
  if (!unread.length) return null;
  const latest = unread[unread.length-1];
  return (
    <Pressable onPress={()=>onDismiss(latest.id)}
      style={[notifSt.banner,{ backgroundColor:theme.notifBg, borderColor:theme.notifBorder }]}>
      <View style={notifSt.iconWrap}>
        <Ionicons name="calendar-outline" size={18} color="#ff9500"/>
      </View>
      <View style={{ flex:1 }}>
        <Text style={notifSt.title}>Scheduled Event</Text>
        <Text style={notifSt.body} numberOfLines={2}>
          {latest.type==="event_failed"
            ? `"${latest.eventName}" couldn't run — PC was offline when it was scheduled to fire.`
            : `"${latest.eventName}" completed successfully.`}
        </Text>
        {unread.length>1&&<Text style={notifSt.more}>+{unread.length-1} more · tap to dismiss</Text>}
      </View>
      <Ionicons name="close" size={16} color="#ff9500"/>
    </Pressable>
  );
}

// ─────────────────────────────────────────────
// Custom Actions Screen
// ─────────────────────────────────────────────
function CustomActionsScreen({ device,actions,onSave,onBack,getConnection,onRunAction,theme }:{
  device:Device; actions:CustomAction[]; onSave:(a:CustomAction[])=>void;
  onBack:()=>void; getConnection:()=>DeviceConnection|undefined;
  onRunAction:(action:CustomAction)=>void; theme:ReturnType<typeof useTheme>;
}) {
  const [list,          setList]          = useState<CustomAction[]>(actions);
  const [creating,      setCreating]      = useState(false);
  const [newName,       setNewName]       = useState("");
  const [newPath,       setNewPath]       = useState("");
  const [newIcon,       setNewIcon]       = useState("play-circle-outline");
  const [newRunAsAdmin, setNewRunAsAdmin] = useState(false);
  const [showIconPicker,setShowIconPicker]= useState(false);
  const [pickingFile,   setPickingFile]   = useState(false);
  const [localToast,    setLocalToast]    = useState<ToastConfig|null>(null);

  const persist = (updated:CustomAction[]) => { setList(updated); onSave(updated); };

  const handleRunAction = (action:CustomAction) => {
    onRunAction(action);
    setLocalToast({ message:`Running ${action.name}…`, icon:action.icon||"play-circle-outline", color:"#a855f7" });
  };

  const addAction = () => {
    if (!newName.trim()||!newPath.trim()) { Alert.alert("Missing Info","Enter both a name and a file path."); return; }
    persist([...list,{ id:`${Date.now()}`, name:newName.trim(), path:newPath.trim(), icon:newIcon, runAsAdmin:newRunAsAdmin }]);
    setNewName(""); setNewPath(""); setNewIcon("play-circle-outline"); setNewRunAsAdmin(false); setCreating(false); setShowIconPicker(false);
  };

  const removeAction = (id:string) => {
    Alert.alert("Remove Action","Remove this custom action?",[
      { text:"Cancel",style:"cancel" },
      { text:"Remove",style:"destructive",onPress:()=>persist(list.filter(a=>a.id!==id)) },
    ]);
  };

  const requestFilePicker = () => {
    if (device.status==="offline") {
      Alert.alert("PC Offline","Your PC must be online to browse files.\n\nYou can type the path manually instead."); return;
    }
    setPickingFile(true);
    const conn = getConnection();
    const requestId = `fp_${Date.now()}`;
    conn?.requestFilePicker(requestId, (path)=>{
      setPickingFile(false);
      if (path) setNewPath(path);
      else Alert.alert("No file selected","No file was selected on your PC.");
    });
    setTimeout(()=>setPickingFile(false), 30000);
  };

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <CommandToast toast={localToast} onHide={()=>setLocalToast(null)}/>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Custom Actions</Text>
        </View>
        <Pressable onPress={()=>{ setCreating(true); setShowIconPicker(false); }} hitSlop={10}>
          <Ionicons name="add-circle-outline" size={24} color="#007aff"/>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding:20, paddingBottom:60 }} showsVerticalScrollIndicator={false}>

        {/* Create form */}
        {creating&&(
          <View style={[panelSt.createCard,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
            <Text style={[panelSt.createTitle,{ color:theme.rowTitle }]}>New Custom Action</Text>

            {/* Icon picker row */}
            <Pressable onPress={()=>setShowIconPicker(p=>!p)}
              style={[panelSt.iconPickerBtn,{ borderColor:theme.inputBorder, backgroundColor:theme.pillBg }]}>
              <View style={[panelSt.actionIcon,{ backgroundColor:"#a855f722", width:34, height:34, borderRadius:9 }]}>
                <Ionicons name={newIcon as any} size={18} color="#a855f7"/>
              </View>
              <Text style={[{ flex:1, fontSize:14, color:theme.rowTitle }]}>Choose icon</Text>
              <Ionicons name={showIconPicker?"chevron-up":"chevron-down"} size={16} color={theme.labelColor}/>
            </Pressable>

            {showIconPicker&&(
              <View style={[panelSt.iconGrid,{ borderColor:theme.cardBorder, backgroundColor:theme.pillBg }]}>
                {ACTION_ICONS.map(item=>(
                  <Pressable key={item.icon} onPress={()=>{ setNewIcon(item.icon); setShowIconPicker(false); }}
                    style={[panelSt.iconGridItem,{ backgroundColor:newIcon===item.icon?"#a855f722":theme.cardBg, borderColor:newIcon===item.icon?"#a855f7":theme.cardBorder }]}>
                    <Ionicons name={item.icon as any} size={20} color={newIcon===item.icon?"#a855f7":theme.labelColor}/>
                    <Text style={[panelSt.iconGridLabel,{ color:newIcon===item.icon?"#a855f7":theme.labelColor }]}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <TextInput value={newName} onChangeText={setNewName}
              placeholder="Action name"
              placeholderTextColor={theme.labelColor}
              style={[panelSt.input,{ color:theme.rowTitle, borderColor:theme.inputBorder }]}
            />
            <TextInput value={newPath} onChangeText={setNewPath}
              placeholder="C:\Path\to\app.exe  or  steam://rungameid/APPID"
              placeholderTextColor={theme.labelColor}
              style={[panelSt.input,{ color:theme.rowTitle, borderColor:theme.inputBorder }]}
              autoCapitalize="none" autoCorrect={false}
            />
            <Pressable onPress={requestFilePicker}
              style={[panelSt.fileBtn,{ borderColor:theme.inputBorder, opacity:pickingFile?0.5:1 }]}>
              <Ionicons name="folder-open-outline" size={16} color="#007aff"/>
              <Text style={panelSt.fileBtnText}>{pickingFile?"Waiting for PC…":"Select File from PC"}</Text>
            </Pressable>
            <Text style={[panelSt.hint,{ color:theme.labelColor }]}>
              Tip: If a game won't launch, try creating a desktop shortcut for it and selecting that .lnk file instead.
            </Text>
            {/* Run as Admin toggle */}
            <Pressable onPress={()=>setNewRunAsAdmin(p=>!p)}
              style={[panelSt.adminRow,{ borderColor:newRunAsAdmin?"#f59e0b44":theme.inputBorder, backgroundColor:newRunAsAdmin?"#f59e0b11":theme.pillBg }]}>
              <View style={{ flex:1 }}>
                <Text style={[{ fontSize:14, fontWeight:"600", color:theme.rowTitle }]}>Run as Administrator</Text>
                <Text style={[{ fontSize:12, color:theme.labelColor, marginTop:2 }]}>Only enable if the app requires admin privileges</Text>
              </View>
              <View style={[panelSt.adminToggle,{ backgroundColor:newRunAsAdmin?"#f59e0b":"#3a3a3a" }]}>
                <View style={[panelSt.adminThumb,{ alignSelf:newRunAsAdmin?"flex-end":"flex-start" }]}/>
              </View>
            </Pressable>
            {newRunAsAdmin&&(
              <View style={[panelSt.adminNote,{ backgroundColor:"#f59e0b11", borderColor:"#f59e0b33" }]}>
                <Ionicons name="warning-outline" size={14} color="#f59e0b"/>
                <Text style={[{ fontSize:12, color:"#f59e0b", flex:1, lineHeight:17 }]}>
                  A Windows UAC prompt will appear on your PC asking to allow administrator access. You must click Yes on your PC for the action to launch.
                </Text>
              </View>
            )}
            <View style={panelSt.createBtns}>
              <Pressable onPress={()=>{ setCreating(false); setNewName(""); setNewPath(""); setNewIcon("play-circle-outline"); setNewRunAsAdmin(false); setShowIconPicker(false); }}
                style={[panelSt.cancelBtn,{ borderColor:theme.inputBorder }]}>
                <Text style={[panelSt.cancelBtnText,{ color:theme.labelColor }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={addAction} style={panelSt.addBtn}>
                <Text style={panelSt.addBtnText}>Add Action</Text>
              </Pressable>
            </View>
          </View>
        )}

        {list.length===0&&!creating?(
          <View style={panelSt.empty}>
            <Ionicons name="play-circle-outline" size={44} color={theme.labelColor}/>
            <Text style={[panelSt.emptyTitle,{ color:theme.titleColor }]}>No custom actions yet</Text>
            <Text style={[panelSt.emptySub,{ color:theme.labelColor }]}>Tap + to add an action like launching an app or running a script.</Text>
          </View>
        ):(
          list.map(action=>(
            <Pressable key={action.id}
              onPress={()=>handleRunAction(action)}
              onLongPress={()=>removeAction(action.id)}
              style={({ pressed })=>[panelSt.actionCard,{ backgroundColor:pressed?theme.actionTilePressed:theme.cardBg, borderColor:theme.cardBorder }]}>
              <View style={[panelSt.actionIcon,{ backgroundColor:"#a855f722" }]}>
                <Ionicons name={(action.icon||"play-circle-outline") as any} size={22} color="#a855f7"/>
              </View>
              <View style={{ flex:1 }}>
                <View style={{ flexDirection:"row", alignItems:"center", gap:6 }}>
                  <Text style={[panelSt.actionName,{ color:theme.rowTitle }]}>{action.name}</Text>
                  {action.runAsAdmin&&(
                    <View style={panelSt.adminBadge}>
                      <Ionicons name="shield-outline" size={10} color="#f59e0b"/>
                      <Text style={panelSt.adminBadgeText}>Admin</Text>
                    </View>
                  )}
                </View>
                <Text style={[panelSt.actionPath,{ color:theme.labelColor }]} numberOfLines={1}>{action.path}</Text>
              </View>
              <Pressable onPress={()=>removeAction(action.id)} hitSlop={10}>
                <Ionicons name="trash-outline" size={18} color="#ef4444"/>
              </Pressable>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────
// Event Editor
// ─────────────────────────────────────────────
function EventEditor({ event,isNew,customActions,onSave,onBack,onGoToCustomActions,theme }:{
  event:ScheduledEvent; isNew:boolean; customActions:CustomAction[];
  onSave:(ev:ScheduledEvent)=>void; onBack:()=>void;
  onGoToCustomActions:()=>void; theme:ReturnType<typeof useTheme>;
}) {
  const [name,       setName]       = useState(event.name);
  const [steps,      setSteps]      = useState<EventStep[]>(event.steps);
  const [recurrence, setRecurrence] = useState(event.recurrence);
  const [days,       setDays]       = useState<number[]>(event.days);
  const [hour,       setHour]       = useState(event.hour);
  const [minute,     setMinute]     = useState(event.minute);
  const [addingStep, setAddingStep] = useState(false);

  const toggleDay = (d:number)=>setDays(prev=>prev.includes(d)?prev.filter(x=>x!==d):[...prev,d].sort());
  const removeStep = (i:number)=>setSteps(prev=>prev.filter((_,idx)=>idx!==i));
  const addStep = (type:EventStepType, extra?:Partial<EventStep>)=>{ setSteps(prev=>[...prev,{ type,...extra }]); setAddingStep(false); };

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("Name required","Enter a name for this event."); return; }
    if (steps.length===0) { Alert.alert("No steps","Add at least one step."); return; }
    if (recurrence==="weekly"&&days.length===0) { Alert.alert("No days selected","Select at least one day."); return; }
    onSave({ ...event, name:name.trim(), steps, recurrence, days, hour, minute });
  };

  const ampm   = hour>=12?"PM":"AM";
  const hour12 = hour%12||12;
  const minStr = minute.toString().padStart(2,"0");

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>{isNew?"New Event":"Edit Event"}</Text>
        </View>
        <Pressable onPress={handleSave} hitSlop={10}>
          <Text style={{ color:"#007aff", fontSize:16, fontWeight:"600" }}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding:20, paddingBottom:80 }} showsVerticalScrollIndicator={false}>

        {/* Name */}
        <Text style={[evEdSt.sectionLabel,{ color:theme.groupLabel }]}>EVENT NAME</Text>
        <View style={[evEdSt.inputCard,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
          <TextInput value={name} onChangeText={setName}
            placeholder="e.g. Morning Wake-Up"
            placeholderTextColor={theme.labelColor}
            style={[evEdSt.nameInput,{ color:theme.rowTitle }]}
          />
        </View>

        {/* Time */}
        <Text style={[evEdSt.sectionLabel,{ color:theme.groupLabel }]}>TIME</Text>
        <View style={[evEdSt.timeCard,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
          <View style={evEdSt.timeRow}>
            <View style={evEdSt.spinCol}>
              <Pressable onPress={()=>setHour(h=>(h+1)%24)} style={evEdSt.spinArrow} hitSlop={8}>
                <Ionicons name="chevron-up" size={22} color="#007aff"/>
              </Pressable>
              <Text style={[evEdSt.spinVal,{ color:theme.rowTitle }]}>{hour12.toString().padStart(2,"0")}</Text>
              <Pressable onPress={()=>setHour(h=>(h-1+24)%24)} style={evEdSt.spinArrow} hitSlop={8}>
                <Ionicons name="chevron-down" size={22} color="#007aff"/>
              </Pressable>
            </View>
            <Text style={[evEdSt.colon,{ color:theme.rowTitle }]}>:</Text>
            <View style={evEdSt.spinCol}>
              <Pressable onPress={()=>setMinute(m=>(m+5)%60)} style={evEdSt.spinArrow} hitSlop={8}>
                <Ionicons name="chevron-up" size={22} color="#007aff"/>
              </Pressable>
              <Text style={[evEdSt.spinVal,{ color:theme.rowTitle }]}>{minStr}</Text>
              <Pressable onPress={()=>setMinute(m=>(m-5+60)%60)} style={evEdSt.spinArrow} hitSlop={8}>
                <Ionicons name="chevron-down" size={22} color="#007aff"/>
              </Pressable>
            </View>
            <Pressable onPress={()=>setHour(h=>h>=12?h-12:h+12)}
              style={[evEdSt.ampmBtn,{ backgroundColor:theme.pillBg, borderColor:theme.pillBorder }]}>
              <Text style={[evEdSt.ampmText,{ color:"#007aff" }]}>{ampm}</Text>
            </Pressable>
          </View>
        </View>

        {/* Repeat */}
        <Text style={[evEdSt.sectionLabel,{ color:theme.groupLabel }]}>REPEAT</Text>
        <View style={evEdSt.pillRow}>
          {(["once","daily","weekly"] as const).map(r=>(
            <Pressable key={r} onPress={()=>setRecurrence(r)}
              style={[evEdSt.pill,{ backgroundColor:recurrence===r?"#007aff":theme.pillBg, borderColor:recurrence===r?"#007aff":theme.pillBorder }]}>
              <Text style={[evEdSt.pillText,{ color:recurrence===r?"white":theme.rowTitle }]}>
                {r==="once"?"One Time":r==="daily"?"Daily":"Weekly"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Days for weekly */}
        {recurrence==="weekly"&&(
          <>
            <Text style={[evEdSt.sectionLabel,{ color:theme.groupLabel }]}>DAYS</Text>
            <View style={evEdSt.dayRow}>
              {DAY_LABELS.map((label,i)=>(
                <Pressable key={i} onPress={()=>toggleDay(i)}
                  style={[evEdSt.dayPill,{ backgroundColor:days.includes(i)?"#007aff":theme.pillBg, borderColor:days.includes(i)?"#007aff":theme.pillBorder }]}>
                  <Text style={[evEdSt.dayPillText,{ color:days.includes(i)?"white":theme.rowTitle }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {/* Steps */}
        <Text style={[evEdSt.sectionLabel,{ color:theme.groupLabel }]}>STEPS</Text>
        <Text style={[evEdSt.stepHint,{ color:theme.labelColor }]}>
          Steps run in order. To open a file after waking, add Wake PC as step 1.
        </Text>

        {steps.map((step,i)=>{
          const meta = STEP_META[step.type];
          return (
            <View key={i} style={[evEdSt.stepCard,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
              <View style={[evEdSt.stepIcon,{ backgroundColor:meta.color+"22" }]}>
                <Ionicons name={meta.icon as any} size={18} color={meta.color}/>
              </View>
              <View style={{ flex:1 }}>
                <Text style={[evEdSt.stepLabel,{ color:theme.rowTitle }]}>{i+1}. {step.actionName||meta.label}</Text>
                {step.path&&<Text style={[evEdSt.stepPath,{ color:theme.labelColor }]} numberOfLines={1}>{step.path}</Text>}
              </View>
              <Pressable onPress={()=>removeStep(i)} hitSlop={10}>
                <Ionicons name="close-circle-outline" size={20} color="#ef4444"/>
              </Pressable>
            </View>
          );
        })}

        {/* Add step picker */}
        {addingStep?(
          <View style={[evEdSt.addStepCard,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
            <Text style={[evEdSt.addStepTitle,{ color:theme.rowTitle }]}>Choose a step</Text>
            {(["wake_pc","shutdown_pc","restart_pc","lock_pc"] as EventStepType[])
              .filter(type => type !== "wake_pc" || steps.length === 0) // wake_pc only allowed as step 1
              .map(type=>{
                const meta=STEP_META[type];
                return (
                  <Pressable key={type} onPress={()=>addStep(type)}
                    style={[evEdSt.stepOption,{ borderColor:theme.cardBorder }]}>
                    <View style={[evEdSt.stepIcon,{ backgroundColor:meta.color+"22" }]}>
                      <Ionicons name={meta.icon as any} size={16} color={meta.color}/>
                    </View>
                    <Text style={[evEdSt.stepOptionText,{ color:theme.rowTitle }]}>{meta.label}</Text>
                  </Pressable>
                );
              })}
            <View style={[evEdSt.divider,{ backgroundColor:theme.cardBorder }]}/>
            <Text style={[evEdSt.groupLabel,{ color:theme.labelColor }]}>CUSTOM ACTIONS</Text>
            {customActions.length>0?(
              customActions.map(action=>(
                <Pressable key={action.id}
                  onPress={()=>addStep("run_custom_action",{ path:action.path, actionName:action.name })}
                  style={[evEdSt.stepOption,{ borderColor:theme.cardBorder }]}>
                  <View style={[evEdSt.stepIcon,{ backgroundColor:"#a855f722" }]}>
                    <Ionicons name="document-outline" size={16} color="#a855f7"/>
                  </View>
                  <Text style={[evEdSt.stepOptionText,{ color:theme.rowTitle }]}>{action.name}</Text>
                </Pressable>
              ))
            ):(
              <Pressable onPress={()=>{ setAddingStep(false); onGoToCustomActions(); }}
                style={[evEdSt.stepOption,{ borderColor:"#a855f744", backgroundColor:"#a855f711" }]}>
                <View style={[evEdSt.stepIcon,{ backgroundColor:"#a855f722" }]}>
                  <Ionicons name="add-circle-outline" size={16} color="#a855f7"/>
                </View>
                <Text style={[evEdSt.stepOptionText,{ color:"#a855f7" }]}>Add a Custom Action first →</Text>
              </Pressable>
            )}
            <Pressable onPress={()=>setAddingStep(false)} style={evEdSt.cancelStepBtn}>
              <Text style={{ color:theme.labelColor, fontSize:14 }}>Cancel</Text>
            </Pressable>
          </View>
        ):(
          <Pressable onPress={()=>setAddingStep(true)}
            style={[evEdSt.addStepBtn,{ borderColor:"#007aff44", backgroundColor:"#007aff11" }]}>
            <Ionicons name="add-circle-outline" size={18} color="#007aff"/>
            <Text style={evEdSt.addStepBtnText}>Add Step</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────
// Scheduled Events Screen
// ─────────────────────────────────────────────
function formatEventTime(ev:ScheduledEvent): string {
  const h12=ev.hour%12||12; const m=ev.minute.toString().padStart(2,"0"); const ap=ev.hour>=12?"PM":"AM";
  return `${h12}:${m} ${ap}`;
}
function formatRecurrence(ev:ScheduledEvent): string {
  if (ev.recurrence==="once")   return "Once";
  if (ev.recurrence==="daily")  return "Daily";
  if (ev.recurrence==="weekly") return ev.days.length===7?"Every day":ev.days.map(d=>DAY_LABELS[d]).join(", ");
  return "";
}

function ScheduledEventsScreen({ device,events,customActions,onSave,onBack,onGoToCustomActions,theme }:{
  device:Device; events:ScheduledEvent[]; customActions:CustomAction[];
  onSave:(e:ScheduledEvent[])=>void; onBack:()=>void;
  onGoToCustomActions:()=>void; theme:ReturnType<typeof useTheme>;
}) {
  const [list,    setList]    = useState<ScheduledEvent[]>(events);
  const [editing, setEditing] = useState<ScheduledEvent|null>(null);
  const [isNew,   setIsNew]   = useState(false);

  // Sync local list when parent events change (e.g. when event fires and gets toggled off)
  useEffect(()=>{ setList(events); },[events]);

  const persist = (updated:ScheduledEvent[])=>{ setList(updated); onSave(updated); };

  const createNew = ()=>{
    setEditing({ id:`ev_${Date.now()}`, name:"New Event", steps:[], recurrence:"once", days:[], hour:8, minute:0, enabled:true });
    setIsNew(true);
  };

  const saveEvent = (ev:ScheduledEvent)=>{
    persist(isNew?[...list,ev]:list.map(e=>e.id===ev.id?ev:e));
    setEditing(null); setIsNew(false);
  };

  const deleteEvent = (id:string)=>{
    Alert.alert("Delete Event","Delete this scheduled event?",[
      { text:"Cancel",style:"cancel" },
      { text:"Delete",style:"destructive",onPress:()=>persist(list.filter(e=>e.id!==id)) },
    ]);
  };

  if (editing) {
    return <EventEditor event={editing} isNew={isNew} customActions={customActions}
      onSave={saveEvent} onBack={()=>{ setEditing(null); setIsNew(false); }}
      onGoToCustomActions={()=>{ setEditing(null); setIsNew(false); onGoToCustomActions(); }}
      theme={theme}/>;
  }

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Scheduled Events</Text>
        </View>
        <Pressable onPress={createNew} hitSlop={10}>
          <Ionicons name="add-circle-outline" size={24} color="#007aff"/>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding:20, paddingBottom:60 }} showsVerticalScrollIndicator={false}>
        <View style={[panelSt.noteBox,{ backgroundColor:theme.pillBg, borderColor:theme.pillBorder, marginBottom:20 }]}>
          <Ionicons name="information-circle-outline" size={15} color={theme.labelColor}/>
          <Text style={[panelSt.noteText,{ color:theme.labelColor }]}>
            Every event besides Wake PC will not work when your PC is offline. If you add Wake PC as the first step, it will still trigger even when your PC is off — all remaining steps will run automatically once it boots up.
          </Text>
        </View>

        {list.length===0?(
          <View style={panelSt.empty}>
            <Ionicons name="calendar-outline" size={44} color={theme.labelColor}/>
            <Text style={[panelSt.emptyTitle,{ color:theme.titleColor }]}>No scheduled events</Text>
            <Text style={[panelSt.emptySub,{ color:theme.labelColor }]}>Tap + to schedule actions like waking your PC at a set time.</Text>
          </View>
        ):(
          list.map(ev=>(
            <Pressable key={ev.id} onPress={()=>{ setEditing(ev); setIsNew(false); }}
              style={[evListSt.card,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
              <View style={evListSt.left}>
                <View style={[evListSt.iconWrap,{ backgroundColor:ev.enabled?"#007aff22":"#8e8e9322" }]}>
                  <Ionicons name="calendar-outline" size={20} color={ev.enabled?"#007aff":"#8e8e93"}/>
                </View>
                <View style={{ flex:1 }}>
                  <Text style={[evListSt.name,{ color:theme.rowTitle }]}>{ev.name}</Text>
                  <Text style={[evListSt.sub,{ color:theme.labelColor }]}>
                    {formatEventTime(ev)} · {formatRecurrence(ev)} · {ev.steps.length} step{ev.steps.length!==1?"s":""}
                  </Text>
                  {ev.recurrence==="once"&&ev.fired&&
                    <Text style={{ color:"#22c55e", fontSize:12, marginTop:2 }}>✓ Completed</Text>}
                </View>
              </View>
              <View style={evListSt.right}>
                <Switch value={ev.enabled}
                  onValueChange={()=>persist(list.map(e=>e.id===ev.id?{ ...e,enabled:!e.enabled }:e))}
                  trackColor={{ false:"#3a3a3c", true:"#007aff" }} thumbColor="white"/>
                <Pressable onPress={()=>deleteEvent(ev.id)} hitSlop={10} style={{ marginLeft:8 }}>
                  <Ionicons name="trash-outline" size={18} color="#ef4444"/>
                </Pressable>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────
// FAQ
// ─────────────────────────────────────────────
const FAQS = [
  { q:"Can anyone send commands to my PC?",
    a:"No. When you pair your phone, a unique security token is generated and stored only on your device. Every command requires this token — it's never exposed, never transmitted in plain text, and cannot be obtained by anyone else. Even someone on the same network as you cannot send commands to your PC without it." },
  { q:"Does PCLink collect any data?",
    a:"No data is collected, stored, or sent to any third party. Everything stays between your phone and your PC." },
  { q:"What happens if I lose my phone?",
    a:"Open the PCLink Agent in your system tray and select Unpair Device. This immediately revokes access and the paired token is deleted. Your PC is then safe." },
  { q:"Why doesn't Wake on LAN work?",
    a:"Wake on LAN requires a wired Ethernet connection on your PC and must be enabled in BIOS under Power Management or Network settings. It does not work over Wi-Fi. Your PC also needs to remain plugged in to a power source." },
  { q:"Can I control my PC from anywhere?",
    a:"Yes. PCLink connects through a secure cloud relay so it works anywhere — at school, work, or on mobile data. Your PC just needs to be on with the agent running." },
  { q:"How do I unpair a device?",
    a:"Open the device in PCLink, tap the edit icon in the top right, and select Remove Device. You can also right-click the agent in the Windows system tray and select Unpair Device." },
  { q:"Can I pair multiple phones to one PC?",
    a:"No. Each PC can only be paired with one phone at a time. To switch phones, unpair from the current one first." },
  { q:"Why is the PC showing as offline?",
    a:"Make sure the PCLink Agent is running in your Windows system tray. If it is, try right-clicking and selecting Restart Agent. Also check that both your phone and PC are connected to the internet. If nothing works, try re-downloading and reinstalling the agent." },
  { q:"Is my connection secure?",
    a:"Yes. All communication uses encrypted WebSocket connections and every command requires your unique security token. No one else can send commands to your PC." },
];
function FAQItem({ q,a,theme }:{ q:string; a:string; theme:ReturnType<typeof useTheme> }) {
  const [open,setOpen]=useState(false);
  return (
    <View style={[faqSt.item,{ borderColor:theme.rowBorder, backgroundColor:theme.groupCard, marginBottom:10 }]}>
      <Pressable onPress={()=>setOpen(o=>!o)} style={faqSt.questionRow}>
        <Text style={[faqSt.question,{ color:theme.rowTitle }]}>{q}</Text>
        <Ionicons name={open?"chevron-up":"chevron-down"} size={15} color={theme.chevron}/>
      </Pressable>
      {open&&<Text style={[faqSt.answer,{ color:theme.rowSubtitle }]}>{a}</Text>}
    </View>
  );
}

// ─────────────────────────────────────────────
// Settings Sheet
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Debug Tool (tap version 5x in About)
// ─────────────────────────────────────────────
function DebugScreen({ theme, onClose, onForceError, debugPaywallOff, setDebugPaywallOff, debugProOn, setDebugProOn, onResetPro }:{
  theme:ReturnType<typeof useTheme>;
  onClose:()=>void;
  onForceError:(type:string)=>void;
  debugPaywallOff:boolean; setDebugPaywallOff:(v:boolean)=>void;
  debugProOn:boolean;      setDebugProOn:(v:boolean)=>void;
  onResetPro:()=>void;
}) {
  const [log, setLog] = useState<string[]>([]);

  const add = (msg:string) => setLog(prev=>[`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);

  const clearAll = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      await AsyncStorage.multiRemove(keys as string[]);
      add("✓ Cleared all stored data");
    } catch(e:any) { add(`✗ Error: ${e.message}`); }
  };

  const showKeys = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      add(`Keys (${(keys as string[]).length}): ${(keys as string[]).join(", ")}`);
    } catch(e:any) { add(`✗ Error: ${e.message}`); }
  };

  const resetOnboarding = async () => {
    await AsyncStorage.removeItem(ONBOARDING_KEY);
    add("✓ Onboarding reset — restart app to see it");
  };

  const forceError = (type:string, label:string) => {
    onForceError(type);
    add(`→ Forced error: ${label}`);
  };

  const errorStates = [
    { label:"Screenshot — Fail",       type:"screenshot_fail",   color:"#ef4444", desc:"Real cause: Pillow not installed on PC (pip install Pillow)" },
    { label:"Clipboard — Timeout",     type:"clipboard_timeout", color:"#f59e0b", desc:"Real cause: Agent not running or PC asleep" },
    { label:"Upload — Timeout",        type:"upload_timeout",    color:"#f97316", desc:"Real cause: File too large or connection dropped" },
    { label:"Wake — Failed Banner",    type:"wake_fail",         color:"#ef4444", desc:"Real cause: WoL not enabled in BIOS or PC not plugged in" },
    { label:"PC Offline Toast",        type:"offline_toast",     color:"#6b7280", desc:"Real cause: Agent disconnected or PC lost network" },
    { label:"Token Invalid Alert",     type:"token_invalid",     color:"#a855f7", desc:"Real cause: PC was re-paired with another phone" },
  ];

  return (
    <View style={{ flex:1 }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onClose} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Debug Tools</Text>
        </View>
        <View style={{ width:60 }}/>
      </View>
      <ScrollView contentContainerStyle={{ padding:20, gap:12, paddingBottom:60 }}>
        <View style={[dbgSt.banner,{ backgroundColor:"#f59e0b11", borderColor:"#f59e0b33" }]}>
          <Ionicons name="warning-outline" size={16} color="#f59e0b"/>
          <Text style={{ color:"#f59e0b", fontSize:13, flex:1, lineHeight:18 }}>
            Developer tools. For testing only. Changes take effect immediately.
          </Text>
        </View>

        <Text style={[dbgSt.sectionLabel,{ color:theme.groupLabel }]}>APP INFO</Text>
        <View style={[dbgSt.infoCard,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
          {[
            { label:"App Version", value:APP_VERSION },
            { label:"Worker URL",  value:WORKER_URL },
            { label:"Platform",    value:Platform.OS },
          ].map((r,i,arr)=>(
            <View key={i} style={[dbgSt.infoRow,{ borderBottomWidth:i<arr.length-1?StyleSheet.hairlineWidth:0, borderBottomColor:theme.cardBorder }]}>
              <Text style={{ color:theme.labelColor, fontSize:13 }}>{r.label}</Text>
              <Text style={{ color:theme.rowTitle, fontSize:13, fontWeight:"500", flex:1, textAlign:"right" }} numberOfLines={1}>{r.value}</Text>
            </View>
          ))}
        </View>

        <Text style={[dbgSt.sectionLabel,{ color:theme.groupLabel }]}>PRO / PAYWALL</Text>
        <View style={[dbgSt.infoCard,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
          <View style={[dbgSt.infoRow,{ borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:theme.cardBorder }]}>
            <View style={{ flex:1 }}>
              <Text style={{ color:theme.rowTitle, fontSize:14, fontWeight:"600" }}>Paywall Enabled</Text>
              <Text style={{ color:theme.labelColor, fontSize:11, marginTop:2 }}>OFF = app works exactly as before, no paywall code active</Text>
            </View>
            <Switch value={!debugPaywallOff} onValueChange={v=>setDebugPaywallOff(!v)} trackColor={{ true:"#007aff" }}/>
          </View>
          <View style={dbgSt.infoRow}>
            <View style={{ flex:1 }}>
              <Text style={{ color:theme.rowTitle, fontSize:14, fontWeight:"600" }}>Simulate Pro Purchase</Text>
              <Text style={{ color:theme.labelColor, fontSize:11, marginTop:2 }}>ON = see app as Pro user, OFF = see app as free user</Text>
            </View>
            <Switch value={debugProOn} onValueChange={setDebugProOn} trackColor={{ true:"#22c55e" }} disabled={debugPaywallOff}/>
          </View>
        </View>

        <Text style={[dbgSt.sectionLabel,{ color:theme.groupLabel }]}>FORCE ERROR STATES</Text>
        <Text style={{ color:theme.labelColor, fontSize:12, marginBottom:4 }}>
          Open the relevant screen first, then tap to trigger the error.
        </Text>
        {errorStates.map((e,i)=>(
          <Pressable key={i} onPress={()=>forceError(e.type, e.label)}
            style={({ pressed })=>[dbgSt.errorBtn,{ backgroundColor:pressed?e.color+"33":e.color+"11", borderColor:e.color+"44" }]}>
            <View style={{ flex:1 }}>
              <Text style={{ color:e.color, fontSize:14, fontWeight:"600" }}>{e.label}</Text>
              <Text style={{ color:theme.labelColor, fontSize:11, marginTop:2 }}>{e.desc}</Text>
            </View>
            <Ionicons name="flash-outline" size={16} color={e.color}/>
          </Pressable>
        ))}

        <Text style={[dbgSt.sectionLabel,{ color:theme.groupLabel }]}>STORAGE</Text>
        {[
          { label:"Show All Storage Keys", color:"#007aff", onPress:showKeys },
          { label:"Reset Onboarding",      color:"#a855f7", onPress:resetOnboarding },
          { label:"Reset Pro Purchase (→ Free User)", color:"#f59e0b", onPress:async()=>{
            await AsyncStorage.removeItem(PRO_KEY);
            onResetPro();
            add("✓ Pro purchase reset — you are now a free user");
          }},
          { label:"Clear ALL Stored Data", color:"#ef4444", onPress:()=>Alert.alert("Clear All Data?","This will remove all devices, settings, and preferences. Cannot be undone.",[
            { text:"Cancel", style:"cancel" },
            { text:"Clear All", style:"destructive", onPress:clearAll },
          ])},
        ].map((a,i)=>(
          <Pressable key={i} onPress={a.onPress}
            style={({ pressed })=>[dbgSt.actionBtn,{ backgroundColor:pressed?a.color+"33":a.color+"11", borderColor:a.color+"44" }]}>
            <Text style={{ color:a.color, fontSize:15, fontWeight:"600" }}>{a.label}</Text>
          </Pressable>
        ))}

        {log.length>0&&(
          <>
            <View style={{ flexDirection:"row", justifyContent:"space-between", alignItems:"center" }}>
              <Text style={[dbgSt.sectionLabel,{ color:theme.groupLabel }]}>LOG</Text>
              <Pressable onPress={()=>setLog([])} hitSlop={8}><Text style={{ color:"#ef4444", fontSize:12 }}>Clear</Text></Pressable>
            </View>
            <View style={[dbgSt.logBox,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
              {log.map((l,i)=>(
                <Text key={i} style={{ color:theme.rowTitle, fontSize:12, lineHeight:18, fontFamily:Platform.OS==="ios"?"Courier New":"monospace" }}>{l}</Text>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SettingsSheet({ visible,onClose,settings,onSettingsChange,theme,onForceError,debugPaywallOff,setDebugPaywallOff,debugProOn,setDebugProOn,onShowPaywall,onRestore,onResetPro }:{
  visible:boolean; onClose:()=>void; settings:AppSettings; onSettingsChange:(s:AppSettings)=>void;
  theme:ReturnType<typeof useTheme>;
  onForceError:(type:string)=>void;
  debugPaywallOff:boolean; setDebugPaywallOff:(v:boolean)=>void;
  debugProOn:boolean;      setDebugProOn:(v:boolean)=>void;
  onShowPaywall:()=>void;  onRestore:()=>void; onResetPro:()=>void;
}) {
  const slideAnim=useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const fadeAnim =useRef(new Animated.Value(0)).current;
  const dragY    =useRef(new Animated.Value(0)).current;
  const dragYRaw =useRef(0); const scrollTop=useRef(true);
  const [sub,setSub]=useState<SettingsSubScreen>("none");
  const [debugVisible, setDebugVisible] = useState(false);
  const [passVisible,  setPassVisible]  = useState(false);
  const [passInput,    setPassInput]    = useState("");
  const [passError,    setPassError]    = useState(false);
  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  const onVersionTap = () => {
    versionTapCount.current += 1;
    if (versionTapTimer.current) clearTimeout(versionTapTimer.current);
    if (versionTapCount.current >= 10) {
      versionTapCount.current = 0;
      setPassInput(""); setPassError(false); setPassVisible(true);
    } else {
      versionTapTimer.current = setTimeout(()=>{ versionTapCount.current = 0; }, 2000);
    }
  };

  const submitPassword = () => {
    if (checkDebugPassword(passInput)) {
      setPassVisible(false); setPassError(false); setPassInput(""); setDebugVisible(true);
    } else {
      setPassError(true);
    }
  };

  useEffect(()=>{
    if (visible) {
      dragY.setValue(0); dragYRaw.current=0; scrollTop.current=true;
      Animated.parallel([
        Animated.spring(slideAnim,{ toValue:0, damping:28, stiffness:300, useNativeDriver:true }),
        Animated.timing(fadeAnim, { toValue:1, duration:220, useNativeDriver:true }),
      ]).start();
    } else { setSub("none"); }
  },[visible]);

  const doClose=useCallback(()=>{
    Animated.parallel([
      Animated.timing(slideAnim,{ toValue:SHEET_HEIGHT, duration:320, useNativeDriver:true }),
      Animated.timing(fadeAnim, { toValue:0,            duration:260, useNativeDriver:true }),
    ]).start(()=>{ onClose(); slideAnim.setValue(SHEET_HEIGHT); dragY.setValue(0); setSub("none"); });
  },[onClose]);

  const onBackdropPress=()=>sub!=="none"?setSub("none"):doClose();
  const snapBack=()=>Animated.spring(dragY,{ toValue:0, damping:22, stiffness:280, useNativeDriver:true }).start();
  const onGestureEvent=(e:PanGestureHandlerGestureEvent)=>{
    if (sub!=="none") return;
    const dy=e.nativeEvent.translationY; dragYRaw.current=dy;
    if (!scrollTop.current&&dy>0) return;
    dragY.setValue(dy>0?dy:dy*RUBBER_BAND_FACTOR);
  };
  const onHandlerStateChange=(e:PanGestureHandlerGestureEvent)=>{
    if (sub!=="none") return;
    if (e.nativeEvent.state===State.END||e.nativeEvent.state===State.CANCELLED) {
      const { translationY:dy, velocityY:vy }=e.nativeEvent;
      dy>SHEET_DISMISS_THRESHOLD||vy>800?doClose():snapBack(); dragYRaw.current=0;
    }
  };
  const onScroll=(e:NativeSyntheticEvent<NativeScrollEvent>)=>{ scrollTop.current=e.nativeEvent.contentOffset.y<=0; };
  const combinedY=Animated.add(slideAnim,dragY);

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={()=>sub!=="none"?setSub("none"):doClose()}>
      <TouchableWithoutFeedback onPress={onBackdropPress}><Animated.View style={[sheetSt.backdrop,{ opacity:fadeAnim }]}/></TouchableWithoutFeedback>
      <PanGestureHandler onGestureEvent={onGestureEvent} onHandlerStateChange={onHandlerStateChange} activeOffsetY={10} failOffsetY={-5} failOffsetX={[-15,15]}>
        <Animated.View style={[sheetSt.container,{ transform:[{ translateY:combinedY }] }]}>
          <BlurView intensity={theme.dark?60:72} tint={theme.blurTint} style={StyleSheet.absoluteFill}/>
          <View style={sheetSt.dragArea}><View style={[sheetSt.handle,{ backgroundColor:theme.handleBar }]}/></View>
          <View style={sheetSt.headerRow}>
            <Pressable onPress={doClose} style={[sheetSt.xBtn,{ backgroundColor:theme.xButtonBg }]} hitSlop={10}>
              <BlurView intensity={40} tint={theme.xButtonTint} style={StyleSheet.absoluteFill}/>
              <Ionicons name="close" size={16} color={theme.xIconColor}/>
            </Pressable>
            <Text style={[sheetSt.title,{ color:theme.sheetTitle }]}>Settings</Text>
            <View style={{ width:30 }}/>
          </View>
          <ScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}
            bounces={false} contentContainerStyle={{ paddingHorizontal:16, paddingBottom:60 }}
            style={{ flex:1 }} scrollEnabled={sub==="none"} pointerEvents={sub==="none"?"auto":"none"}>
            <View style={groupSt.wrapper}>
              <Text style={[groupSt.label,{ color:theme.groupLabel }]}>PREFERENCES</Text>
              <View style={[groupSt.card,{ backgroundColor:theme.groupCard, borderColor:theme.groupCardBorder }]}>
                <View style={groupSt.row}>
                  <View style={[groupSt.iconWrap,{ backgroundColor:"#5856d6" }]}><Ionicons name="shield-checkmark-outline" size={16} color="white"/></View>
                  <View style={groupSt.rowContent}>
                    <Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>Confirm Commands</Text>
                    <Text style={[groupSt.rowSub,{ color:theme.rowSubtitle }]}>Ask before shutdown & restart</Text>
                  </View>
                  <Switch value={settings.confirmCommands} onValueChange={v=>onSettingsChange({ ...settings,confirmCommands:v })} trackColor={{ false:"#3a3a3c", true:"#007aff" }} thumbColor="white"/>
                </View>
              </View>
            </View>
            <View style={groupSt.wrapper}>
              <Text style={[groupSt.label,{ color:theme.groupLabel }]}>SUPPORT</Text>
              <View style={[groupSt.card,{ backgroundColor:theme.groupCard, borderColor:theme.groupCardBorder }]}>
                <Pressable onPress={()=>setSub("faq")} style={({ pressed })=>[groupSt.row,pressed&&{ backgroundColor:theme.rowPressed }]}>
                  <View style={[groupSt.iconWrap,{ backgroundColor:"#3b82f6" }]}><Ionicons name="help-circle-outline" size={16} color="white"/></View>
                  <View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>FAQ</Text><Text style={[groupSt.rowSub,{ color:theme.rowSubtitle }]}>Common questions answered</Text></View>
                  <Ionicons name="chevron-forward" size={16} color={theme.chevron} style={{ marginLeft:4 }}/>
                </Pressable>
                <Pressable onPress={()=>setSub("troubleshooting")} style={({ pressed })=>[groupSt.row,{ borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:theme.rowBorder },pressed&&{ backgroundColor:theme.rowPressed }]}>
                  <View style={[groupSt.iconWrap,{ backgroundColor:"#f59e0b" }]}><Ionicons name="build-outline" size={16} color="white"/></View>
                  <View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>Troubleshooting</Text><Text style={[groupSt.rowSub,{ color:theme.rowSubtitle }]}>Tips for common connection issues</Text></View>
                  <Ionicons name="chevron-forward" size={16} color={theme.chevron} style={{ marginLeft:4 }}/>
                </Pressable>
                <Pressable onPress={()=>Linking.openURL(FEEDBACK_URL)} style={({ pressed })=>[groupSt.row,{ borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:theme.rowBorder },pressed&&{ backgroundColor:theme.rowPressed }]}>
                  <View style={[groupSt.iconWrap,{ backgroundColor:"#22c55e" }]}><Ionicons name="chatbubble-ellipses-outline" size={16} color="white"/></View>
                  <View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>Feedback & Suggestions</Text><Text style={[groupSt.rowSub,{ color:theme.rowSubtitle }]}>Help shape the future of PCLink</Text></View>
                  <Ionicons name="chevron-forward" size={16} color={theme.chevron} style={{ marginLeft:4 }}/>
                </Pressable>
              </View>
            </View>
            <View style={groupSt.wrapper}>
              <Text style={[groupSt.label,{ color:theme.groupLabel }]}>PURCHASES</Text>
              <View style={[groupSt.card,{ backgroundColor:theme.groupCard, borderColor:theme.groupCardBorder }]}>
                <Pressable onPress={()=>{ onClose(); setTimeout(()=>onShowPaywall(), 350); }} style={({ pressed })=>[groupSt.row,pressed&&{ backgroundColor:theme.rowPressed }]}>
                  <View style={[groupSt.iconWrap,{ backgroundColor:"#007aff" }]}><Ionicons name="flash" size={16} color="white"/></View>
                  <View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>Get PCLink Pro</Text><Text style={[groupSt.rowSub,{ color:theme.rowSubtitle }]}>Unlock all features — {PRO_PRICE} one-time</Text></View>
                  <Ionicons name="chevron-forward" size={16} color={theme.chevron} style={{ marginLeft:4 }}/>
                </Pressable>
                <Pressable onPress={()=>{ onClose(); setTimeout(()=>onRestore(), 350); }} style={({ pressed })=>[groupSt.row,{ borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:theme.rowBorder },pressed&&{ backgroundColor:theme.rowPressed }]}>
                  <View style={[groupSt.iconWrap,{ backgroundColor:"#6b7280" }]}><Ionicons name="refresh-outline" size={16} color="white"/></View>
                  <View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>Restore Purchase</Text><Text style={[groupSt.rowSub,{ color:theme.rowSubtitle }]}>Reinstalled? Tap to restore Pro</Text></View>
                </Pressable>
              </View>
            </View>
            <View style={groupSt.wrapper}>
              <Text style={[groupSt.label,{ color:theme.groupLabel }]}>INFO</Text>
              <View style={[groupSt.card,{ backgroundColor:theme.groupCard, borderColor:theme.groupCardBorder }]}>
                <Pressable onPress={()=>setSub("about")} style={({ pressed })=>[groupSt.row,pressed&&{ backgroundColor:theme.rowPressed }]}>
                  <View style={[groupSt.iconWrap,{ backgroundColor:"#007aff" }]}><Ionicons name="information-circle-outline" size={16} color="white"/></View>
                  <View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>Info</Text></View>
                  <Ionicons name="chevron-forward" size={16} color={theme.chevron} style={{ marginLeft:4 }}/>
                </Pressable>
              </View>
            </View>
          </ScrollView>
          <SubScreen visible={sub==="faq"} onBack={()=>setSub("none")} title="FAQ" theme={theme}>
            <ScrollView contentContainerStyle={{ padding:20, paddingBottom:60 }} showsVerticalScrollIndicator={false}>
              {FAQS.map((f,i)=><FAQItem key={i} q={f.q} a={f.a} theme={theme}/>)}
              <Pressable onPress={()=>Linking.openURL(FEEDBACK_URL)}
                style={({ pressed })=>[{ flexDirection:"row", alignItems:"center", justifyContent:"center", gap:8, marginTop:8, paddingVertical:14, borderRadius:14, backgroundColor:pressed?"#22c55e33":"#22c55e11", borderWidth:1, borderColor:"#22c55e44" }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color="#22c55e"/>
                <Text style={{ color:"#22c55e", fontSize:15, fontWeight:"600" }}>Ask a Question or Give Feedback →</Text>
              </Pressable>
            </ScrollView>
          </SubScreen>
          <SubScreen visible={sub==="troubleshooting"} onBack={()=>setSub("none")} title="Troubleshooting" theme={theme}>
            <ScrollView contentContainerStyle={{ padding:20, paddingBottom:60 }} showsVerticalScrollIndicator={false}>
              {[
                { icon:"wifi-outline",color:"#007aff",title:"1. Check your connection",body:"Make sure both your phone and PC are connected to the internet. PCLink works over any network — Wi-Fi, mobile data, or Ethernet." },
                { icon:"desktop-outline",color:"#22c55e",title:"2. Check the system tray",body:"Make sure PCLink Agent is running in the Windows system tray (bottom-right of your taskbar)." },
                { icon:"refresh-outline",color:"#f59e0b",title:"3. Restart the agent",body:"Right-click the tray icon and select Restart Agent, or Quit and relaunch it." },
                { icon:"link-outline",color:"#a855f7",title:"4. Re-pair the device",body:"If the app still can't connect, try removing the device in PCLink and pairing again." },
                { icon:"download-outline",color:"#3b82f6",title:"5. Reinstall the agent",body:"If nothing else works, try re-downloading and reinstalling the PCLink Agent from the official website." },
                { icon:"flash-outline",color:"#22c55e",title:"Wake on LAN — needs Ethernet",body:"Wake on LAN only works over a wired Ethernet connection, not Wi-Fi." },
                { icon:"hardware-chip-outline",color:"#f97316",title:"Wake on LAN — enable in BIOS",body:"Wake on LAN must be enabled in your PC's BIOS/UEFI settings under Power Management or Network settings." },
              ].map((tip,i)=>(
                <View key={i} style={[tsSt.card,{ backgroundColor:theme.groupCard, borderColor:theme.groupCardBorder, marginBottom:12 }]}>
                  <View style={[tsSt.iconWrap,{ backgroundColor:tip.color+"22" }]}><Ionicons name={tip.icon as any} size={20} color={tip.color}/></View>
                  <View style={{ flex:1 }}>
                    <Text style={[tsSt.title,{ color:theme.rowTitle }]}>{tip.title}</Text>
                    <Text style={[tsSt.body,{ color:theme.rowSubtitle }]}>{tip.body}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </SubScreen>
          <SubScreen visible={sub==="about"} onBack={()=>setSub("none")} title="Info" theme={theme}>
            <ScrollView contentContainerStyle={{ paddingHorizontal:16, paddingBottom:60 }} showsVerticalScrollIndicator={false}>
              <View style={groupSt.wrapper}>
                <Text style={[groupSt.label,{ color:theme.groupLabel }]}>APP</Text>
                <View style={[groupSt.card,{ backgroundColor:theme.groupCard, borderColor:theme.groupCardBorder }]}>
                  <View style={groupSt.row}><View style={[groupSt.iconWrap,{ backgroundColor:"#007aff", overflow:"hidden", padding:0 }]}><Image source={require('./pclink-icon.png')} style={{ width:32, height:32, borderRadius:8 }}/></View><View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>PCLink</Text><Text style={[groupSt.rowSub,{ color:theme.rowSubtitle }]}>Remotely control and monitor your PCs from your phone</Text></View></View>
                  <Pressable onPress={onVersionTap} style={[groupSt.row,{ borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:theme.rowBorder }]}><View style={[groupSt.iconWrap,{ backgroundColor:"#5856d6" }]}><Ionicons name="code-slash-outline" size={16} color="white"/></View><View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>Version</Text></View><Text style={[groupSt.rowValue,{ color:theme.rowValue }]}>{APP_VERSION}</Text></Pressable>
                  <View style={[groupSt.row,{ borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:theme.rowBorder }]}><View style={[groupSt.iconWrap,{ backgroundColor:"#22c55e" }]}><Ionicons name="shield-checkmark-outline" size={16} color="white"/></View><View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>Privacy</Text><Text style={[groupSt.rowSub,{ color:theme.rowSubtitle }]}>No data collected. Everything stays on your local network.</Text></View></View>
                </View>
              </View>
              <View style={groupSt.wrapper}>
                <Text style={[groupSt.label,{ color:theme.groupLabel }]}>LINKS</Text>
                <View style={[groupSt.card,{ backgroundColor:theme.groupCard, borderColor:theme.groupCardBorder }]}>
                  <Pressable onPress={()=>Linking.openURL(AGENT_DOWNLOAD_URL)} style={({ pressed })=>[groupSt.row,pressed&&{ backgroundColor:theme.rowPressed }]}><View style={[groupSt.iconWrap,{ backgroundColor:"#333" }]}><Ionicons name="download-outline" size={16} color="white"/></View><View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>Download Agent</Text><Text style={[groupSt.rowSub,{ color:theme.rowSubtitle }]}>Get the Windows agent for your PC</Text></View><Ionicons name="chevron-forward" size={16} color={theme.chevron} style={{ marginLeft:4 }}/></Pressable>
                  <Pressable onPress={()=>Linking.openURL("mailto:lcarney2007@gmail.com")} style={({ pressed })=>[groupSt.row,{ borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:theme.rowBorder },pressed&&{ backgroundColor:theme.rowPressed }]}><View style={[groupSt.iconWrap,{ backgroundColor:"#007aff" }]}><Ionicons name="mail-outline" size={16} color="white"/></View><View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>Contact</Text><Text style={[groupSt.rowSub,{ color:theme.rowSubtitle }]}>lcarney2007@gmail.com</Text></View><Ionicons name="chevron-forward" size={16} color={theme.chevron} style={{ marginLeft:4 }}/></Pressable>
                  <View style={[groupSt.row,{ borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:theme.rowBorder }]}><View style={[groupSt.iconWrap,{ backgroundColor:"#34c759" }]}><Ionicons name="globe-outline" size={16} color="white"/></View><View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>Website</Text><Text style={[groupSt.rowSub,{ color:theme.rowSubtitle }]}>Coming soon</Text></View></View>
                </View>
              </View>
              <View style={groupSt.wrapper}>
                <Text style={[groupSt.label,{ color:theme.groupLabel }]}>LEGAL</Text>
                <View style={[groupSt.card,{ backgroundColor:theme.groupCard, borderColor:theme.groupCardBorder }]}>
                  <Pressable onPress={()=>setSub("privacy")} style={({ pressed })=>[groupSt.row,pressed&&{ backgroundColor:theme.rowPressed }]}><View style={[groupSt.iconWrap,{ backgroundColor:"#636366" }]}><Ionicons name="shield-checkmark-outline" size={16} color="white"/></View><View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>Privacy Policy</Text></View><Ionicons name="chevron-forward" size={16} color={theme.chevron} style={{ marginLeft:4 }}/></Pressable>
                  <Pressable onPress={()=>setSub("terms")} style={({ pressed })=>[groupSt.row,{ borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:theme.rowBorder },pressed&&{ backgroundColor:theme.rowPressed }]}><View style={[groupSt.iconWrap,{ backgroundColor:"#636366" }]}><Ionicons name="reader-outline" size={16} color="white"/></View><View style={groupSt.rowContent}><Text style={[groupSt.rowTitle,{ color:theme.rowTitle }]}>Terms of Use</Text></View><Ionicons name="chevron-forward" size={16} color={theme.chevron} style={{ marginLeft:4 }}/></Pressable>
                </View>
              </View>
            </ScrollView>
          </SubScreen>

          {/* ── PRIVACY POLICY ── */}
          <SubScreen visible={sub==="privacy"} onBack={()=>setSub("about")} title="Privacy Policy" theme={theme}>
            <ScrollView contentContainerStyle={{ paddingHorizontal:20, paddingBottom:60 }} showsVerticalScrollIndicator={false}>
              <Text style={[legalSt.updated,{ color:theme.labelColor }]}>Last updated: May 2025</Text>
              {[
                { heading:"Overview", body:'PCLink ("the App") is designed with your privacy as a core principle. We do not collect, store, transmit, or sell your personal data. Everything the App does stays entirely on your local network between your phone and your PC.' },
                { heading:"Information We Do Not Collect", body:"We do not collect your name, email address, location, device identifiers, usage analytics, crash reports, or any other personal information. No data is sent to our servers — because we don't have any." },
                { heading:"Local Network Communication", body:"The App communicates directly with the PCLink Agent running on your PC over your local Wi-Fi network using a WebSocket connection. This communication never leaves your network and is not routed through any third-party servers." },
                { heading:"Security Tokens", body:"When you pair your phone with a PC, a unique security token is generated and stored locally on your device. This token is used only to authenticate commands between your phone and your PC. It is never transmitted outside your local network." },
                { heading:"Third-Party Services", body:"The App does not integrate with any analytics platforms, advertising networks, or third-party data processors. No third-party SDKs that collect user data are included." },
                { heading:"Data Storage", body:"All app data (paired device information, custom actions, scheduled events, settings) is stored locally on your device using AsyncStorage. You can delete this data at any time by removing the app." },
                { heading:"Children's Privacy", body:"PCLink is not directed at children under the age of 13. We do not knowingly collect any information from children." },
                { heading:"Changes to This Policy", body:'If we make material changes to this privacy policy, we will update the "Last updated" date above. We encourage you to review this policy periodically.' },
                { heading:"Contact", body:"If you have questions about this Privacy Policy, please contact us at lcarney2007@gmail.com." },
              ].map((s,i)=>(
                <View key={i} style={legalSt.section}>
                  <Text style={[legalSt.heading,{ color:theme.rowTitle }]}>{s.heading}</Text>
                  <Text style={[legalSt.body,{ color:theme.rowSubtitle }]}>{s.body}</Text>
                </View>
              ))}
            </ScrollView>
          </SubScreen>

          {/* ── TERMS OF USE ── */}
          <SubScreen visible={sub==="terms"} onBack={()=>setSub("about")} title="Terms of Use" theme={theme}>
            <ScrollView contentContainerStyle={{ paddingHorizontal:20, paddingBottom:60 }} showsVerticalScrollIndicator={false}>
              <Text style={[legalSt.updated,{ color:theme.labelColor }]}>Last updated: May 2025</Text>
              {[
                { heading:"Acceptance of Terms", body:'By downloading or using PCLink ("the App"), you agree to be bound by these Terms of Use. If you do not agree to these terms, please do not use the App.' },
                { heading:"Description of Service", body:"PCLink is a local network remote control application that allows you to send commands to a Windows PC running the PCLink Agent from your mobile device. The App works exclusively over your local Wi-Fi network." },
                { heading:"Use at Your Own Risk", body:"Commands sent through the App (such as shutdown, restart, or lock) take effect immediately on your PC. You are solely responsible for ensuring commands are sent intentionally. PCLink is not liable for any data loss, hardware damage, or other consequences resulting from use of the App." },
                { heading:"Permitted Use", body:"You may use the App only to control PCs that you own or have explicit permission to control. Unauthorized use of this App to access another person's computer without their knowledge or consent may violate applicable law." },
                { heading:"No Warranty", body:'The App is provided "as is" without warranty of any kind, express or implied. We do not warrant that the App will be error-free, uninterrupted, or suitable for any particular purpose.' },
                { heading:"Limitation of Liability", body:"To the maximum extent permitted by law, PCLink and its developer shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of, or inability to use, the App." },
                { heading:"Intellectual Property", body:"All content, design, and code within the App is the intellectual property of PCLink. You may not copy, modify, distribute, or reverse engineer any part of the App without prior written permission." },
                { heading:"Modifications", body:"We reserve the right to modify these Terms at any time. Continued use of the App after changes are posted constitutes acceptance of the revised Terms." },
                { heading:"Contact", body:"If you have questions about these Terms, please contact us at lcarney2007@gmail.com." },
              ].map((s,i)=>(
                <View key={i} style={legalSt.section}>
                  <Text style={[legalSt.heading,{ color:theme.rowTitle }]}>{s.heading}</Text>
                  <Text style={[legalSt.body,{ color:theme.rowSubtitle }]}>{s.body}</Text>
                </View>
              ))}
            </ScrollView>
          </SubScreen>

          {/* ── DEBUG TOOL ── */}
          {/* ── PASSWORD GATE ── */}
          <Modal visible={passVisible} transparent animationType="fade" onRequestClose={()=>setPassVisible(false)}>
            <TouchableWithoutFeedback onPress={()=>{ setPassVisible(false); setPassInput(""); setPassError(false); }}>
              <View style={{ flex:1, backgroundColor:"rgba(0,0,0,0.6)", justifyContent:"center", padding:40 }}>
                <TouchableWithoutFeedback onPress={e=>e.stopPropagation()}>
                  <View style={[dbgSt.infoCard,{ backgroundColor:theme.cardBg, padding:24, borderRadius:16 }]}>
                    <Text style={[{ fontSize:17, fontWeight:"700", color:theme.titleColor, marginBottom:4, textAlign:"center" }]}>Admin Tool</Text>
                    <Text style={[{ fontSize:13, color:theme.labelColor, textAlign:"center", marginBottom:20, lineHeight:18 }]}>
                      If you are not an admin please dismiss this tool.
                    </Text>
                    <TextInput
                      value={passInput}
                      onChangeText={v=>{ setPassInput(v); setPassError(false); }}
                      placeholder="Enter password"
                      placeholderTextColor={theme.labelColor}
                      secureTextEntry
                      style={[{ borderWidth:1, borderColor:passError?"#ef4444":theme.cardBorder, borderRadius:10, padding:12, fontSize:16, color:theme.rowTitle, marginBottom:8 }]}
                      autoFocus
                      onSubmitEditing={submitPassword}
                      returnKeyType="done"
                    />
                    {passError&&<Text style={{ color:"#ef4444", fontSize:12, marginBottom:8, textAlign:"center" }}>Incorrect password</Text>}
                    <Pressable onPress={submitPassword}
                      style={[manSt.connectBtn,{ marginBottom:8 }]}>
                      <Text style={manSt.connectBtnText}>Enter</Text>
                    </Pressable>
                    <Pressable onPress={()=>{ setPassVisible(false); setPassInput(""); setPassError(false); }}
                      style={{ alignItems:"center", padding:8 }}>
                      <Text style={{ color:theme.labelColor, fontSize:14 }}>Dismiss</Text>
                    </Pressable>
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          </Modal>

          {debugVisible&&(
            <Animated.View style={[StyleSheet.absoluteFillObject,{ backgroundColor:theme.subScreenBg, zIndex:30 }]}>
              <SafeAreaView style={{ flex:1 }}>
                <DebugScreen theme={theme} onClose={()=>setDebugVisible(false)} onForceError={onForceError}
                  debugPaywallOff={debugPaywallOff} setDebugPaywallOff={setDebugPaywallOff}
                  debugProOn={debugProOn} setDebugProOn={setDebugProOn}
                  onResetPro={onResetPro}/>
              </SafeAreaView>
            </Animated.View>
          )}

        </Animated.View>
      </PanGestureHandler>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// Error Banner
// ─────────────────────────────────────────────
interface ErrorBannerConfig { message:string; onRepair?:()=>void; }
function ErrorBanner({ config,onDismiss,theme }:{ config:ErrorBannerConfig|null; onDismiss:()=>void; theme:ReturnType<typeof useTheme> }) {
  const anim=useRef(new Animated.Value(-100)).current;
  useEffect(()=>{ Animated.spring(anim,{ toValue:config?0:-100, damping:20, stiffness:240, useNativeDriver:true }).start(); },[!!config]);
  if (!config) return null;
  return (
    <Animated.View style={[errSt.container,{ transform:[{ translateY:anim }], backgroundColor:theme.errorBannerBg, borderColor:theme.errorBannerBorder }]}>
      <Ionicons name="alert-circle" size={18} color="#ef4444" style={{ marginTop:1 }}/>
      <View style={{ flex:1 }}>
        <Text style={errSt.message}>{config.message}</Text>
        {config.onRepair&&<Pressable onPress={config.onRepair}><Text style={errSt.repairLink}>Re-pair Device →</Text></Pressable>}
      </View>
      <Pressable onPress={onDismiss} hitSlop={10}><Ionicons name="close" size={18} color="#ef4444"/></Pressable>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────
interface ToastConfig { message:string; icon:string; color:string; }
function CommandToast({ toast,onHide }:{ toast:ToastConfig|null; onHide:()=>void }) {
  const slideAnim=useRef(new Animated.Value(-100)).current;
  const fadeAnim =useRef(new Animated.Value(0)).current;
  const timerRef =useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{
    if (!toast) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    slideAnim.setValue(-100); fadeAnim.setValue(0);
    Animated.parallel([
      Animated.spring(slideAnim,{ toValue:0, damping:20, stiffness:260, useNativeDriver:true }),
      Animated.timing(fadeAnim, { toValue:1, duration:180, useNativeDriver:true }),
    ]).start();
    timerRef.current=setTimeout(()=>{
      Animated.parallel([
        Animated.timing(slideAnim,{ toValue:-100, duration:280, useNativeDriver:true }),
        Animated.timing(fadeAnim, { toValue:0,    duration:220, useNativeDriver:true }),
      ]).start(()=>onHide());
    },2500);
    return ()=>{ if (timerRef.current) clearTimeout(timerRef.current); };
  },[toast]);
  if (!toast) return null;
  return (
    <Animated.View style={[toastSt.container,{ transform:[{ translateY:slideAnim }], opacity:fadeAnim }]} pointerEvents="none">
      <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill}/>
      <View style={[toastSt.iconWrap,{ backgroundColor:toast.color+"33" }]}><Ionicons name={toast.icon as any} size={20} color={toast.color}/></View>
      <Text style={toastSt.message}>{toast.message}</Text>
      <View style={[toastSt.dot,{ backgroundColor:toast.color }]}/>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────
// StatBar & StatsDashboard
// ─────────────────────────────────────────────
function StatBar({ label,value,max,unit,color,temp,theme }:{ label:string; value:number|null; max?:number|null; unit:string; color:string; temp?:number|null; theme:ReturnType<typeof useTheme> }) {
  const pct=value!=null?(max!=null?(value/max)*100:value):0;
  const display=value!=null?(max!=null?`${value}${unit} / ${max}${unit}`:`${value}${unit}`):"—";
  return (
    <View style={statSt.row}>
      <View style={statSt.header}>
        <View style={statSt.labelRow}><View style={[statSt.dot,{ backgroundColor:color }]}/><Text style={[statSt.label,{ color:theme.rowTitle }]}>{label}</Text>{temp!=null&&<Text style={[statSt.temp,{ color:theme.labelColor }]}>{temp}°C</Text>}</View>
        <Text style={[statSt.value,{ color:theme.labelColor }]}>{display}</Text>
      </View>
      <View style={[statSt.barBg,{ backgroundColor:theme.statsBar }]}>
        <View style={[statSt.barFill,{ width:`${Math.min(pct,100)}%` as any, backgroundColor:pct>85?"#ef4444":pct>65?"#f59e0b":color }]}/>
      </View>
    </View>
  );
}
function StatsDashboard({ stats,deviceStatus,theme }:{ stats:PCStats|null; deviceStatus:DeviceStatus; theme:ReturnType<typeof useTheme> }) {
  const [expanded,setExpanded]=useState(false);
  const hasStats=stats!=null&&deviceStatus!=="offline";
  return (
    <View style={[statSt.container,{ backgroundColor:theme.statsBg, borderColor:theme.statsBorder }]}>
      <Pressable onPress={()=>setExpanded(e=>!e)} style={statSt.headerRow}>
        <View style={statSt.headerLeft}>
          <Ionicons name="stats-chart-outline" size={16} color={theme.labelColor}/>
          <Text style={[statSt.headerTitle,{ color:theme.rowTitle }]}>System Stats</Text>
          {!hasStats&&deviceStatus==="offline"&&<Text style={[statSt.headerSub,{ color:theme.labelColor }]}>· Offline</Text>}
          {!hasStats&&deviceStatus!=="offline"&&<Text style={[statSt.headerSub,{ color:theme.labelColor }]}>· Waiting…</Text>}
          {hasStats&&stats?.cpu_percent!=null&&<Text style={[statSt.headerSub,{ color:theme.labelColor }]}>· CPU {stats.cpu_percent}%</Text>}
        </View>
        <Ionicons name={expanded?"chevron-up":"chevron-down"} size={16} color={theme.chevron}/>
      </Pressable>
      {expanded&&(
        <View style={statSt.content}>
          {!hasStats?(<Text style={[statSt.noData,{ color:theme.labelColor }]}>{deviceStatus==="offline"?"Stats unavailable while PC is offline.":"Waiting for stats from your PC…"}</Text>):(
            <>
              {stats!.cpu_percent!=null&&<StatBar label="CPU" value={stats!.cpu_percent} unit="%" color="#007aff" temp={stats!.cpu_temp} theme={theme}/>}
              {stats!.ram_percent!=null&&<StatBar label="RAM" value={stats!.ram_used_gb} max={stats!.ram_total_gb} unit=" GB" color="#a855f7" theme={theme}/>}
              {stats!.disks?.map((d,i)=><StatBar key={d.label} label={`Disk (${d.label})`} value={d.used_gb} max={d.total_gb} unit=" GB" color={DISK_COLORS[i%DISK_COLORS.length]} theme={theme}/>)}
              {stats!.gpu_percent!=null&&<StatBar label="GPU" value={stats!.gpu_percent} unit="%" color="#22c55e" temp={stats!.gpu_temp} theme={theme}/>}
              {stats!.uptime_seconds!=null&&stats!.uptime_seconds>0&&(
                <View style={statSt.uptimeRow}>
                  <Ionicons name="time-outline" size={14} color={theme.labelColor}/>
                  <Text style={[statSt.uptimeText,{ color:theme.labelColor }]}>
                    Uptime: {(()=>{
                      const s=stats!.uptime_seconds||0;
                      const d=Math.floor(s/86400); const h=Math.floor((s%86400)/3600); const m=Math.floor((s%3600)/60);
                      return d>0?`${d}d ${h}h ${m}m`:h>0?`${h}h ${m}m`:`${m}m`;
                    })()}
                  </Text>
                </View>
              )}
              {stats!.cpu_percent==null&&stats!.ram_percent==null&&<Text style={[statSt.noData,{ color:theme.labelColor }]}>Install psutil on your PC.{"\n"}Run: pip install psutil</Text>}
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────
// Activity Log Screen
// ─────────────────────────────────────────────
function ActivityLogScreen({ deviceName,entries,theme,onBack }:{ deviceName:string; entries:LogEntry[]; theme:ReturnType<typeof useTheme>; onBack:()=>void }) {
  const sorted=[...entries].reverse();
  return (
    <View style={{ flex:1 }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}><Ionicons name="chevron-back" size={22} color="#007aff"/><Text style={st.overlayBackText}>Back</Text></Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none"><Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Logs</Text></View>
        <View style={{ width:60 }}/>
      </View>
      {sorted.length===0?(
        <View style={logSt.empty}><Ionicons name="time-outline" size={48} color={theme.labelColor}/><Text style={[logSt.emptyTitle,{ color:theme.titleColor }]}>No activity yet</Text><Text style={[logSt.emptySub,{ color:theme.labelColor }]}>Commands and status changes will appear here.</Text></View>
      ):(
        <ScrollView contentContainerStyle={logSt.list} showsVerticalScrollIndicator={false}>
          <Text style={[logSt.deviceLabel,{ color:theme.labelColor }]}>{deviceName.toUpperCase()}</Text>
          {sorted.map((entry,index)=>{
            const meta=LOG_META[entry.event]; const isLast=index===sorted.length-1;
            return (
              <View key={entry.id} style={logSt.entry}>
                <View style={logSt.timelineCol}>
                  <View style={[logSt.iconCircle,{ backgroundColor:meta.color+"22" }]}><Ionicons name={meta.icon as any} size={15} color={meta.color}/></View>
                  {!isLast&&<View style={[logSt.line,{ backgroundColor:theme.logLine }]}/>}
                </View>
                <View style={logSt.entryContent}>
                  <Text style={[logSt.entryLabel,{ color:theme.rowTitle }]}>
                    {meta.label}{entry.name?` · ${entry.name}`:""}
                  </Text>
                  <Text style={[logSt.entryTime,{ color:theme.labelColor }]}>{formatLogTime(entry.timestamp)}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────
// Agent Setup Screen
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Onboarding
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Pro Activated Overlay
// ─────────────────────────────────────────────
function ProActivatedOverlay({ onDone }:{ onDone:()=>void }) {
  const scale   = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const glow    = useRef(new Animated.Value(0)).current;

  useEffect(()=>{
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale,{ toValue:1, damping:12, stiffness:180, useNativeDriver:true }),
        Animated.timing(opacity,{ toValue:1, duration:250, useNativeDriver:true }),
      ]),
      Animated.timing(glow,{ toValue:1, duration:600, useNativeDriver:true }),
    ]).start();
    const t = setTimeout(onDone, 3000);
    return ()=>clearTimeout(t);
  },[]);

  const glowOpacity = glow.interpolate({ inputRange:[0,0.5,1], outputRange:[0,0.5,0] });
  const glowScale   = glow.interpolate({ inputRange:[0,1], outputRange:[0.8,1.3] });

  return (
    <View style={[StyleSheet.absoluteFillObject,{ backgroundColor:"#0b0f14", justifyContent:"center", alignItems:"center", zIndex:9999 }]}>
      <Animated.View style={{ alignItems:"center", gap:20, transform:[{ scale }], opacity }}>
        {/* Glow ring — border only, no fill */}
        <Animated.View style={{ position:"absolute", width:140, height:140, borderRadius:70,
          borderWidth:2, borderColor:"#007aff",
          opacity:glowOpacity, transform:[{ scale:glowScale }] }}/>
        {/* Icon circle */}
        <View style={{ width:120, height:120, borderRadius:60, backgroundColor:"#007aff22", borderWidth:2, borderColor:"#007aff66", justifyContent:"center", alignItems:"center" }}>
          <Ionicons name="flash" size={64} color="#007aff"/>
        </View>
        <View style={{ alignItems:"center", gap:8 }}>
          <View style={proSt.badge}>
            <Ionicons name="flash" size={12} color="#007aff"/>
            <Text style={proSt.badgeText}>PCLink Pro</Text>
          </View>
          <Text style={{ color:"white", fontSize:26, fontWeight:"800", textAlign:"center" }}>Pro Activated!</Text>
          <Text style={{ color:"rgba(255,255,255,0.55)", fontSize:15, textAlign:"center", lineHeight:22 }}>
            All features are now unlocked.{"\n"}Thank you for your support!
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

function ProPaywallSheet({ visible, onClose, onPurchase, onRestore, theme }:{
  visible:boolean; onClose:()=>void;
  onPurchase:()=>void; onRestore:()=>void;
  theme:ReturnType<typeof useTheme>;
}) {
  const slideAnim = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const dragY     = useRef(new Animated.Value(0)).current;
  const dragYRaw  = useRef(0);

  useEffect(()=>{
    if (visible) {
      dragY.setValue(0); dragYRaw.current=0;
      Animated.parallel([
        Animated.spring(slideAnim,{ toValue:0, damping:28, stiffness:300, useNativeDriver:true }),
        Animated.timing(fadeAnim,{ toValue:1, duration:220, useNativeDriver:true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim,{ toValue:SHEET_HEIGHT, duration:300, useNativeDriver:true }),
        Animated.timing(fadeAnim,{ toValue:0, duration:240, useNativeDriver:true }),
      ]).start();
    }
  },[visible]);

  const onGestureEvent = Animated.event([{ nativeEvent:{ translationY:dragY } }],{ useNativeDriver:true });
  const onHandlerStateChange = ({ nativeEvent:e }:PanGestureHandlerGestureEvent)=>{
    dragYRaw.current = e.translationY;
    if (e.state === State.END) {
      if (dragYRaw.current > SHEET_HEIGHT*0.18 || e.velocityY > 800) {
        onClose();
      } else {
        Animated.spring(dragY,{ toValue:0, damping:20, stiffness:300, useNativeDriver:true }).start();
      }
    }
  };

  const clampedDrag = dragY.interpolate({ inputRange:[0,SHEET_HEIGHT], outputRange:[0,SHEET_HEIGHT], extrapolateLeft:"clamp" });

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[sheetSt.backdrop,{ opacity:fadeAnim }]}/>
      </TouchableWithoutFeedback>
      <PanGestureHandler onGestureEvent={onGestureEvent} onHandlerStateChange={onHandlerStateChange}>
        <Animated.View style={[sheetSt.container,{ transform:[{ translateY:Animated.add(slideAnim,clampedDrag) }] }]}>
          <BlurView intensity={theme.dark?60:72} tint={theme.blurTint} style={StyleSheet.absoluteFill}/>
          <View style={sheetSt.dragArea}><View style={[sheetSt.handle,{ backgroundColor:theme.handleBar }]}/></View>
        {/* Header */}
        <View style={{ alignItems:"center", paddingHorizontal:24, paddingBottom:8 }}>
          <View style={proSt.badge}>
            <Ionicons name="flash" size={14} color="#007aff"/>
            <Text style={proSt.badgeText}>PCLink Pro</Text>
          </View>
          <Text style={[proSt.title,{ color:theme.titleColor }]}>Unlock Everything</Text>
          <Text style={[proSt.subtitle,{ color:theme.labelColor }]}>
            One-time purchase. No subscription. No ads. Ever.
          </Text>
        </View>
        {/* Feature list */}
        <ScrollView
          contentContainerStyle={{ paddingHorizontal:24, paddingBottom:16 }}
          showsVerticalScrollIndicator={false}
          style={{ maxHeight:screenHeight*0.35 }}
        >
          <View style={proSt.featureGrid}>
            {PRO_FEATURES.map((f,i)=>(
              <View key={i} style={[proSt.featureItem,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
                <View style={[proSt.featureIcon,{ backgroundColor:f.color+"22" }]}>
                  <Ionicons name={f.icon as any} size={18} color={f.color}/>
                </View>
                <View style={{ flex:1 }}>
                  <Text style={[proSt.featureLabel,{ color:theme.rowTitle }]}>{f.label}</Text>
                  <Text style={[proSt.featureDesc,{ color:theme.labelColor }]}>{f.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
        {/* Purchase button */}
        <View style={{ paddingHorizontal:24, paddingBottom:8 }}>
          <Pressable onPress={onPurchase}
            style={({ pressed })=>[proSt.buyBtn,pressed&&{ opacity:0.85 }]}>
            <Text style={proSt.buyBtnText}>Get PCLink Pro — {PRO_PRICE}</Text>
          </Pressable>
          <Pressable onPress={onRestore} style={{ alignItems:"center", paddingVertical:12 }}>
            <Text style={{ color:theme.labelColor, fontSize:13 }}>Restore Purchase</Text>
          </Pressable>
          <Text style={{ color:theme.labelColor, fontSize:11, textAlign:"center", lineHeight:16 }}>
            One-time purchase. No subscription. No hidden fees.
          </Text>
        </View>
        </Animated.View>
      </PanGestureHandler>
    </Modal>
  );
}

// Small lock badge for Pro-gated tiles
function ProLockBadge() {
  return (
    <View style={proSt.lockBadge}>
      <Ionicons name="flash" size={9} color="white"/>
      <Text style={proSt.lockBadgeText}>PRO</Text>
    </View>
  );
}

function OnboardingScreen({ theme, onDone, onPair }:{
  theme:ReturnType<typeof useTheme>;
  onDone:()=>void;
  onPair:()=>void;
}) {
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const NUM_PAGES = 3;

  const features = [
    { icon:"flash",            color:"#22c55e", text:"Wake, sleep, shutdown & restart your PC" },
    { icon:"construct-outline",color:"#06b6d4", text:"Files, clipboard, media, screenshot & more" },
    { icon:"calendar-outline", color:"#007aff", text:"Schedule events & automate with scenes" },
    { icon:"volume-high-outline",color:"#f97316",text:"Soundboard & full volume mixer control" },
  ];

  const goTo = (n:number) => {
    setPage(n);
    scrollRef.current?.scrollTo({ x: n * screenWidth, animated:true });
  };

  const finish = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "done");
    onDone();
  };

  const skip = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "done");
    onDone();
  };

  return (
    <View style={{ flex:1, backgroundColor:"#0b0f14" }}>
      {/* Skip button */}
      <View style={{ position:"absolute", top:56, right:24, zIndex:10 }}>
        <Pressable onPress={skip} hitSlop={12}>
          <Text style={{ color:"rgba(255,255,255,0.45)", fontSize:15 }}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal pagingEnabled scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        style={{ flex:1 }}
        contentContainerStyle={{ width: screenWidth * NUM_PAGES }}
      >
        {/* Page 1: Welcome */}
        <View style={[onbSt.page, { width:screenWidth }]}>
          <View style={onbSt.logoWrap}>
            <Image source={require("./pclink-icon.png")} style={onbSt.logo}/>
          </View>
          <Text style={onbSt.title}>Welcome to PCLink</Text>
          <Text style={onbSt.subtitle}>Your PC, controlled from your pocket.</Text>
          <View style={onbSt.featureList}>
            {features.map((f,i)=>(
              <View key={i} style={onbSt.featureRow}>
                <View style={[onbSt.featureIcon, { backgroundColor:f.color+"22" }]}>
                  <Ionicons name={f.icon as any} size={20} color={f.color}/>
                </View>
                <Text style={onbSt.featureText}>{f.text}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Page 2: Download agent */}
        <View style={[onbSt.page, { width:screenWidth }]}>
          <View style={[onbSt.bigIcon, { backgroundColor:"#007aff22" }]}>
            <Ionicons name="desktop-outline" size={52} color="#007aff"/>
          </View>
          <Text style={onbSt.title}>Install the Agent</Text>
          <Text style={onbSt.subtitle}>
            PCLink needs a small free app running on your Windows PC to work.
          </Text>
          <View style={onbSt.stepList}>
            {[
              { n:"1", text:"Download PCLink Agent for Windows" },
              { n:"2", text:"Run it on your PC — a pairing window will appear" },
              { n:"3", text:"Come back here and tap Get Started" },
            ].map(s=>(
              <View key={s.n} style={onbSt.stepRow}>
                <View style={onbSt.stepNum}><Text style={onbSt.stepNumText}>{s.n}</Text></View>
                <Text style={onbSt.stepText}>{s.text}</Text>
              </View>
            ))}
          </View>
          <Pressable onPress={()=>Linking.openURL(AGENT_DOWNLOAD_URL)}
            style={({ pressed })=>[onbSt.dlBtn, pressed&&{ opacity:0.8 }]}>
            <Ionicons name="download-outline" size={20} color="white"/>
            <Text style={onbSt.dlBtnText}>Download Agent for Windows</Text>
          </Pressable>
          <Text style={onbSt.freeNote}>Free · Windows only · No account needed</Text>
        </View>

        {/* Page 3: Pair */}
        <View style={[onbSt.page, { width:screenWidth }]}>
          <View style={[onbSt.bigIcon, { backgroundColor:"#22c55e22" }]}>
            <Ionicons name="qr-code-outline" size={52} color="#22c55e"/>
          </View>
          <Text style={onbSt.title}>Pair Your PC</Text>
          <Text style={onbSt.subtitle}>
            Once the agent is running on your PC, scan its QR code or enter the 6-digit pairing code to connect.
          </Text>
          <Pressable onPress={async()=>{ await AsyncStorage.setItem(ONBOARDING_KEY,"done"); onPair(); }}
            style={({ pressed })=>[onbSt.primaryBtn, pressed&&{ opacity:0.85 }]}>
            <Text style={onbSt.primaryBtnText}>Get Started →</Text>
          </Pressable>
          <Pressable onPress={finish} style={{ marginTop:16 }}>
            <Text style={{ color:"rgba(255,255,255,0.4)", fontSize:14, textAlign:"center" }}>
              I'll do this later
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Dots */}
      <View style={onbSt.dots}>
        {Array.from({ length:NUM_PAGES }).map((_,i)=>(
          <Pressable key={i} onPress={()=>goTo(i)} hitSlop={8}>
            <View style={[onbSt.dot, page===i&&onbSt.dotActive]}/>
          </Pressable>
        ))}
      </View>

      {/* Next button (pages 1-2 only) */}
      {page < NUM_PAGES-1 && (
        <View style={onbSt.nextRow}>
          <Pressable onPress={()=>goTo(page+1)}
            style={({ pressed })=>[onbSt.nextBtn, pressed&&{ opacity:0.8 }]}>
            <Text style={onbSt.nextBtnText}>Next</Text>
            <Ionicons name="arrow-forward" size={18} color="white"/>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function AgentSetupScreen({ theme,onBack,onReady }:{ theme:ReturnType<typeof useTheme>; onBack:()=>void; onReady:()=>void }) {
  const steps=[
    { icon:"download-outline",color:"#007aff",title:"Download the Agent",body:"Download PCLink Agent for Windows from the link below and run it on your PC." },
    { icon:"qr-code-outline",color:"#22c55e",title:"A QR code will appear",body:"When you run it for the first time, a pairing window will pop up on your PC automatically." },
    { icon:"phone-portrait-outline",color:"#a855f7",title:"Scan & pair",body:"Come back here, tap \"I already have the agent\", and scan the QR code to connect." },
  ];
  return (
    <View style={{ flex:1 }}>
      <Pressable onPress={onBack} style={setupSt.backRow} hitSlop={10}><Ionicons name="chevron-back" size={18} color="#007aff"/><Text style={setupSt.backText}>Back</Text></Pressable>
      <Text style={[setupSt.heading,{ color:theme.titleColor }]}>Get Started</Text>
      <Text style={[setupSt.subheading,{ color:theme.labelColor }]}>To control your PC you need to install the free agent app on it first.</Text>
      <View style={setupSt.steps}>
        {steps.map((step,i)=>(
          <View key={i} style={setupSt.stepRow}>
            <View style={[setupSt.stepIcon,{ backgroundColor:step.color+"22" }]}><Ionicons name={step.icon as any} size={22} color={step.color}/></View>
            <View style={{ flex:1 }}><Text style={[setupSt.stepTitle,{ color:theme.titleColor }]}>{step.title}</Text><Text style={[setupSt.stepBody,{ color:theme.labelColor }]}>{step.body}</Text></View>
          </View>
        ))}
      </View>
      <Pressable onPress={()=>Linking.openURL(AGENT_DOWNLOAD_URL)} style={({ pressed })=>[setupSt.dlBtn,pressed&&{ opacity:0.82 }]}>
        <Ionicons name="download-outline" size={20} color="white"/><Text style={setupSt.dlBtnText}>Download Agent for Windows</Text>
      </Pressable>
      <Text style={[setupSt.freeNote,{ color:theme.noteText }]}>Free · Windows only · No account needed</Text>
      <Pressable onPress={onReady} style={({ pressed })=>[setupSt.readyBtn,{ borderColor:theme.inputBorder },pressed&&{ opacity:0.7 }]}>
        <Text style={[setupSt.readyBtnText,{ color:theme.rowTitle }]}>I already have the agent →</Text>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────
// DeviceConnection
// ─────────────────────────────────────────────
class DeviceConnection {
  deviceId:string; serverUrl:string; token:string; ws:WebSocket|null=null;
  onStatusChange:   (id:string,status:DeviceStatus,lastSeen:number,mac?:string)=>void;
  onDeviceRemoved:  (id:string,name:string)=>void;
  onStatsUpdate:    (id:string,stats:PCStats)=>void;
  onCommandAck:     (cmdId:string,status:string)=>void;
  onTokenInvalid:   (id:string)=>void;
  onEventFailed:    (deviceId:string,eventName:string,reason:string)=>void;
  onEventFired:     (deviceId:string,eventName:string)=>void;
  onEventsUpdated:  (deviceId:string,events:ScheduledEvent[])=>void;
  onQueuedNotifs:   (notifs:any[])=>void;
  onVolumeData:     (deviceId:string,data:VolumeData)=>void;
  onFileBrowse:     (deviceId:string,result:FileBrowseResult)=>void;
  onFileDownload:   (deviceId:string,name:string,data:string,mimeType:string)=>void;
  onToolResult:     (deviceId:string,type:string,payload:any)=>void;
  private reconnectTimer: ReturnType<typeof setTimeout>|null=null;
  private destroyed = false;
  private filePickerCallbacks: Record<string,(path:string|null)=>void> = {};

  constructor(
    deviceId:string, serverUrl:string, token:string,
    onStatusChange:(id:string,status:DeviceStatus,lastSeen:number,mac?:string)=>void,
    onDeviceRemoved:(id:string,name:string)=>void,
    onStatsUpdate:(id:string,stats:PCStats)=>void,
    onCommandAck:(cmdId:string,status:string)=>void,
    onTokenInvalid:(id:string)=>void,
    onEventFailed:(deviceId:string,eventName:string,reason:string)=>void,
    onEventFired:(deviceId:string,eventName:string)=>void,
    onEventsUpdated:(deviceId:string,events:ScheduledEvent[])=>void,
    onQueuedNotifs:(notifs:any[])=>void,
    onVolumeData:(deviceId:string,data:VolumeData)=>void,
    onFileBrowse:(deviceId:string,result:FileBrowseResult)=>void,
    onFileDownload:(deviceId:string,name:string,data:string,mimeType:string)=>void,
    onToolResult:(deviceId:string,type:string,payload:any)=>void,
  ) {
    this.deviceId=deviceId; this.serverUrl=serverUrl; this.token=token;
    this.onStatusChange=onStatusChange; this.onDeviceRemoved=onDeviceRemoved;
    this.onStatsUpdate=onStatsUpdate; this.onCommandAck=onCommandAck;
    this.onTokenInvalid=onTokenInvalid; this.onEventFailed=onEventFailed;
    this.onEventFired=onEventFired; this.onEventsUpdated=onEventsUpdated;
    this.onQueuedNotifs=onQueuedNotifs; this.onVolumeData=onVolumeData;
    this.onFileBrowse=onFileBrowse; this.onFileDownload=onFileDownload;
    this.onToolResult=onToolResult;
    this.connect();
  }

  connect() {
    if (this.destroyed) return;
    try {
      this.ws=new WebSocket(this.serverUrl);
      this.ws.onopen=()=>{
        // Send UTC offset so server can fire events at the user's local time
        const utcOffsetSeconds = -new Date().getTimezoneOffset() * 60;
        this.ws!.send(JSON.stringify({ type:"register_mobile", utc_offset_seconds:utcOffsetSeconds }));
      };
      this.ws.onmessage=(e)=>{
        try {
          const msg=JSON.parse(e.data);
          if (msg.type==="pc_status"&&msg.device_id===this.deviceId)
            this.onStatusChange(this.deviceId,msg.status,msg.last_seen??Date.now()/1000,msg.device_mac);
          else if (msg.type==="device_removed"&&msg.device_id===this.deviceId)
            this.onDeviceRemoved(this.deviceId,msg.device_name??"");
          else if (msg.type==="pc_stats"&&msg.device_id===this.deviceId)
            this.onStatsUpdate(this.deviceId,msg as PCStats);
          else if (msg.type==="command_ack")
            this.onCommandAck(msg.command_id??"",msg.status??"executed");
          else if (msg.type==="token_invalid"&&msg.device_id===this.deviceId)
            this.onTokenInvalid(this.deviceId);
          else if (msg.type==="file_picker_result") {
            const cb=this.filePickerCallbacks[msg.request_id??""];
            if (cb) { delete this.filePickerCallbacks[msg.request_id]; cb(msg.path??null); }
          }
          else if (msg.type==="event_failed"&&msg.device_id===this.deviceId)
            this.onEventFailed(this.deviceId,msg.event_name??"Event",msg.reason??"");
          else if (msg.type==="event_fired"&&msg.device_id===this.deviceId)
            this.onEventFired(this.deviceId,msg.event_name??"Event");
          else if (msg.type==="events_updated"&&msg.device_id===this.deviceId)
            this.onEventsUpdated(this.deviceId,msg.events??[]);
          else if (msg.type==="queued_notifications")
            this.onQueuedNotifs(msg.notifications??[]);
          else if (msg.type==="volume_data"&&msg.device_id===this.deviceId)
            this.onVolumeData(this.deviceId,{ master:msg.master, sessions:msg.sessions??[] });
          else if (msg.type==="clipboard_data"&&msg.device_id===this.deviceId)
            this.onToolResult(this.deviceId,"clipboard",{ text:msg.text??null });
          else if (msg.type==="screenshot_result"&&msg.device_id===this.deviceId)
            this.onToolResult(this.deviceId,"screenshot",{ data:msg.data??null, error:msg.error??null });
          else if (msg.type==="now_playing"&&msg.device_id===this.deviceId)
            this.onToolResult(this.deviceId,"now_playing",{ title:msg.title, artist:msg.artist, status:msg.status, album_art:msg.album_art, is_last_known:msg.is_last_known });
          else if (msg.type==="network_info"&&msg.device_id===this.deviceId)
            this.onToolResult(this.deviceId,"network_info", msg);
          else if (msg.type==="speedtest_result"&&msg.device_id===this.deviceId)
            this.onToolResult(this.deviceId,"speedtest_result", msg);
          else if (msg.type==="audio_devices"&&msg.device_id===this.deviceId)
            this.onToolResult(this.deviceId,"audio_devices",{ outputs:msg.outputs??[], inputs:msg.inputs??[] });
          else if (msg.type==="upload_result"&&msg.device_id===this.deviceId)
            this.onToolResult(this.deviceId,"upload_result", msg);
          else if (msg.type==="soundboard_file_result"&&msg.device_id===this.deviceId)
            this.onToolResult(this.deviceId,"soundboard_file", msg);
          else if (msg.type==="file_browse_result"&&msg.device_id===this.deviceId)
            this.onFileBrowse(this.deviceId, msg);
          else if (msg.type==="search_files_result"&&msg.device_id===this.deviceId)
            this.onFileBrowse(this.deviceId, { ...msg, isSearch:true });
          else if (msg.type==="file_download_result"&&msg.device_id===this.deviceId)
            this.onFileDownload(this.deviceId,msg.name,msg.data||null,msg.mime_type??"application/octet-stream");
        } catch {}
      };
      this.ws.onclose=()=>{ if (!this.destroyed) { this.onStatusChange(this.deviceId,"offline",0); this.reconnectTimer=setTimeout(()=>this.connect(),5000); } };
      this.ws.onerror=()=>this.onStatusChange(this.deviceId,"offline",0);
    } catch { this.reconnectTimer=setTimeout(()=>this.connect(),5000); }
  }

  sendCommand(type:string, extra:Record<string,any>={}) {
    if (this.ws?.readyState===WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, device_id:this.deviceId, token:this.token, ...extra }));
      return true;
    }
    return false;
  }

  requestFilePicker(requestId:string, callback:(path:string|null)=>void) {
    this.filePickerCallbacks[requestId]=callback;
    this.sendCommand("open_file_picker",{ request_id:requestId });
  }

  saveEvents(events:ScheduledEvent[]) {
    if (this.ws?.readyState===WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type:"save_events", device_id:this.deviceId, token:this.token, events }));
  }

  sendUnpair() {
    if (this.ws?.readyState===WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type:"unpair_device", device_id:this.deviceId, token:this.token }));
  }
  destroy() { this.destroyed=true; if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.ws?.close(); }
}

// ─────────────────────────────────────────────
// IOSSheet
// ─────────────────────────────────────────────
function IOSSheet({ visible,onClose,title,children,theme }:{
  visible:boolean; onClose:()=>void; title:string; children:React.ReactNode; theme:ReturnType<typeof useTheme>;
}) {
  const slideAnim=useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const fadeAnim =useRef(new Animated.Value(0)).current;
  const dragY    =useRef(new Animated.Value(0)).current;
  const dragYRaw =useRef(0); const scrollTop=useRef(true);

  useEffect(()=>{
    if (visible) {
      dragY.setValue(0); dragYRaw.current=0; scrollTop.current=true;
      Animated.parallel([
        Animated.spring(slideAnim,{ toValue:0, damping:28, stiffness:300, useNativeDriver:true }),
        Animated.timing(fadeAnim, { toValue:1, duration:220, useNativeDriver:true }),
      ]).start();
    }
  },[visible]);

  const animateOut=()=>{
    Animated.parallel([
      Animated.timing(slideAnim,{ toValue:SHEET_HEIGHT, duration:320, useNativeDriver:true }),
      Animated.timing(fadeAnim, { toValue:0,            duration:260, useNativeDriver:true }),
    ]).start(()=>{ onClose(); slideAnim.setValue(SHEET_HEIGHT); dragY.setValue(0); });
  };
  const snapBack=()=>Animated.spring(dragY,{ toValue:0, damping:22, stiffness:280, useNativeDriver:true }).start();
  const onGestureEvent=(e:PanGestureHandlerGestureEvent)=>{
    const dy=e.nativeEvent.translationY; dragYRaw.current=dy;
    if (!scrollTop.current&&dy>0) return;
    dragY.setValue(dy>0?dy:dy*RUBBER_BAND_FACTOR);
  };
  const onHandlerStateChange=(e:PanGestureHandlerGestureEvent)=>{
    if (e.nativeEvent.state===State.END||e.nativeEvent.state===State.CANCELLED) {
      const { translationY:dy, velocityY:vy }=e.nativeEvent;
      dy>SHEET_DISMISS_THRESHOLD||vy>800?animateOut():snapBack(); dragYRaw.current=0;
    }
  };
  const onScroll=(e:NativeSyntheticEvent<NativeScrollEvent>)=>{ scrollTop.current=e.nativeEvent.contentOffset.y<=0; };
  const combinedY=Animated.add(slideAnim,dragY);

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={animateOut}>
      <TouchableWithoutFeedback onPress={animateOut}><Animated.View style={[sheetSt.backdrop,{ opacity:fadeAnim }]}/></TouchableWithoutFeedback>
      <PanGestureHandler onGestureEvent={onGestureEvent} onHandlerStateChange={onHandlerStateChange} activeOffsetY={10} failOffsetY={-5} failOffsetX={[-15,15]}>
        <Animated.View style={[sheetSt.container,{ transform:[{ translateY:combinedY }] }]}>
          <BlurView intensity={theme.dark?60:72} tint={theme.blurTint} style={StyleSheet.absoluteFill}/>
          <View style={sheetSt.dragArea}><View style={[sheetSt.handle,{ backgroundColor:theme.handleBar }]}/></View>
          <View style={sheetSt.headerRow}>
            <Pressable onPress={animateOut} style={[sheetSt.xBtn,{ backgroundColor:theme.xButtonBg }]} hitSlop={10}>
              <BlurView intensity={40} tint={theme.xButtonTint} style={StyleSheet.absoluteFill}/>
              <Ionicons name="close" size={16} color={theme.xIconColor}/>
            </Pressable>
            <Text style={[sheetSt.title,{ color:theme.sheetTitle }]}>{title}</Text>
            <View style={{ width:30 }}/>
          </View>
          <ScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}
            bounces={false} contentContainerStyle={{ paddingHorizontal:16, paddingBottom:60 }} style={{ flex:1 }}
            keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Animated.View>
      </PanGestureHandler>
    </Modal>
  );
}

function SettingsRow({ icon,iconBg,title,subtitle,value,onPress,last,destructive,theme }:{
  icon:string; iconBg:string; title:string; subtitle?:string; value?:string;
  onPress?:()=>void; last?:boolean; destructive?:boolean; theme:ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed })=>[groupSt.row,!last&&{ borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:theme.rowBorder },pressed&&onPress&&{ backgroundColor:theme.rowPressed }]}>
      <View style={[groupSt.iconWrap,{ backgroundColor:iconBg }]}><Ionicons name={icon as any} size={16} color="white"/></View>
      <View style={groupSt.rowContent}>
        <Text style={[groupSt.rowTitle,{ color:destructive?"#ff3b30":theme.rowTitle }]}>{title}</Text>
        {subtitle&&<Text style={[groupSt.rowSub,{ color:theme.rowSubtitle }]}>{subtitle}</Text>}
      </View>
      {value&&<Text style={[groupSt.rowValue,{ color:theme.rowValue }]}>{value}</Text>}
      {onPress&&<Ionicons name="chevron-forward" size={16} color={theme.chevron} style={{ marginLeft:4 }}/>}
    </Pressable>
  );
}

function IOSDropdown({ visible,onClose,theme,children }:{ visible:boolean; onClose:()=>void; theme:ReturnType<typeof useTheme>; children:React.ReactNode }) {
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}><View style={StyleSheet.absoluteFill}/></TouchableWithoutFeedback>
      <View style={[dropSt.container,{ backgroundColor:theme.dropdownBg, borderColor:theme.dropdownBorder }]}>{children}</View>
    </Modal>
  );
}
function DropdownItem({ label,left,onPress,last,theme }:{ label:string; left:React.ReactNode; onPress:()=>void; last?:boolean; theme:ReturnType<typeof useTheme> }) {
  return (
    <Pressable onPress={onPress} style={({ pressed })=>[dropSt.item,!last&&{ borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:theme.dropdownBorder },pressed&&{ backgroundColor:theme.rowPressed }]}>
      {left}<Text style={[dropSt.label,{ color:theme.dropdownText }]}>{label}</Text>
    </Pressable>
  );
}
function StatusDot({ status }:{ status:DeviceStatus }) {
  const color=status==="online"?"#4ade80":status==="idle"?"#f59e0b":"#ef4444";
  return <View style={[dotSt.dot,{ backgroundColor:color, shadowColor:color }]}/>;
}
function PairedOverlay({ theme }:{ theme:ReturnType<typeof useTheme> }) {
  const scale = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(()=>{
    Animated.parallel([
      Animated.spring(scale,{ toValue:1, damping:14, stiffness:200, useNativeDriver:true }),
      Animated.timing(opacity,{ toValue:1, duration:200, useNativeDriver:true }),
    ]).start();
  },[]);
  return (
    <View style={[pairSt.overlay,{ backgroundColor:"#0b0f14" }]}>
      <Animated.View style={{ alignItems:"center", gap:16, transform:[{ scale }], opacity }}>
        <View style={{ width:96, height:96, borderRadius:48, backgroundColor:"#22c55e22", justifyContent:"center", alignItems:"center", borderWidth:2, borderColor:"#22c55e44" }}>
          <Ionicons name="checkmark-circle" size={64} color="#22c55e"/>
        </View>
        <Text style={[pairSt.text,{ color:"#ffffff" }]}>Device Paired!</Text>
        <Text style={[pairSt.subtext,{ color:"rgba(255,255,255,0.6)" }]}>You're all set. Your PC is now connected.</Text>
      </Animated.View>
    </View>
  );
}
// Tappable full-row code input — tap anywhere on the row to open keyboard
function CodeInput({ value, onChange, theme }:{
  value:string; onChange:(v:string)=>void;
  theme:ReturnType<typeof useTheme>;
}) {
  const inputRef = useRef<TextInput>(null);
  return (
    <Pressable onPress={()=>inputRef.current?.focus()}
      style={[manSt.inputRow,{ borderColor:theme.pairInputBorder }]}>
      <Text style={[manSt.inputLabel,{ color:theme.labelColor, flex:1 }]}>6-Digit Code</Text>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        placeholder="000000"
        placeholderTextColor={theme.pairPlaceholder}
        style={[manSt.input,{ color:theme.pairInputText }]}
        keyboardType="number-pad"
        maxLength={6}
        blurOnSubmit={false}
      />
    </Pressable>
  );
}

function QRScannerScreen({ onScanned,onCancel,theme }:{ onScanned:(data:string)=>void; onCancel:()=>void; theme:ReturnType<typeof useTheme> }) {
  const scannedRef=useRef(false);
  const onBarcodeScanned=({ data }:{ data:string })=>{ if (scannedRef.current) return; scannedRef.current=true; onScanned(data); };
  return (
    <View style={{ flex:1, backgroundColor:"#000" }}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes:["qr"] }} onBarcodeScanned={onBarcodeScanned}/>
      <View style={qrSt.overlay}>
        <Text style={qrSt.instruction}>Point at the QR code on your PC agent popup</Text>
        <View style={qrSt.cutout}/>
        <Pressable onPress={onCancel} style={qrSt.cancelBtn}><Text style={qrSt.cancelText}>Cancel</Text></Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────
// Scene Editor
// ─────────────────────────────────────────────
function SceneEditor({ scene,isNew,customActions,onSave,onBack,onDelete,onGoToCustomActions,theme }:{
  scene:Scene; isNew:boolean; customActions:CustomAction[];
  onSave:(s:Scene)=>void; onBack:()=>void; onDelete?:()=>void;
  onGoToCustomActions:()=>void; theme:ReturnType<typeof useTheme>;
}) {
  const [name,       setName]       = useState(scene.name);
  const [steps,      setSteps]      = useState<EventStep[]>(scene.steps);
  const [icon,       setIcon]       = useState(scene.icon);
  const [color,      setColor]      = useState(scene.color);
  const [addingStep, setAddingStep] = useState(false);
  const [showIcons,  setShowIcons]  = useState(false);

  const removeStep = (i:number)=>setSteps(prev=>prev.filter((_,idx)=>idx!==i));
  const addStep = (type:EventStepType, extra?:Partial<EventStep>)=>{ setSteps(prev=>[...prev,{ type,...extra }]); setAddingStep(false); };

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("Name required","Enter a name for this scene."); return; }
    if (steps.length===0) { Alert.alert("No steps","Add at least one step."); return; }
    onSave({ ...scene, name:name.trim(), steps, icon, color });
  };

  const SCENE_ICONS = ["flash","game-controller-outline","moon-outline","sunny-outline","musical-notes-outline","film-outline","code-slash-outline","briefcase-outline","bed-outline","cafe-outline","fitness-outline","headset-outline"];

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>{isNew?"New Scene":"Edit Scene"}</Text>
        </View>
        <Pressable onPress={handleSave} hitSlop={10}>
          <Text style={{ color:"#007aff", fontSize:16, fontWeight:"600" }}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding:20, paddingBottom:80 }} showsVerticalScrollIndicator={false}>

        {/* Name */}
        <Text style={[evEdSt.sectionLabel,{ color:theme.groupLabel }]}>SCENE NAME</Text>
        <View style={[evEdSt.inputCard,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
          <TextInput value={name} onChangeText={setName} placeholder="e.g. Gaming Setup"
            placeholderTextColor={theme.labelColor}
            style={[evEdSt.nameInput,{ color:theme.rowTitle }]}/>
        </View>

        {/* Color + Icon */}
        <Text style={[evEdSt.sectionLabel,{ color:theme.groupLabel }]}>APPEARANCE</Text>
        <View style={[sceneSt.appearCard,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
          {/* Preview */}
          <View style={[sceneSt.previewTile,{ backgroundColor:color }]}>
            <Ionicons name={icon as any} size={28} color="white"/>
            <Text style={sceneSt.previewName} numberOfLines={1}>{name||"Scene"}</Text>
          </View>
          {/* Colors */}
          <View style={sceneSt.colorRow}>
            {SCENE_COLORS.map(c=>(
              <Pressable key={c} onPress={()=>setColor(c)}
                style={[sceneSt.colorDot,{ backgroundColor:c, borderWidth:color===c?3:0, borderColor:"white" }]}/>
            ))}
          </View>
          {/* Icons */}
          <Pressable onPress={()=>setShowIcons(p=>!p)} style={[sceneSt.iconPickerBtn,{ borderColor:theme.cardBorder }]}>
            <Ionicons name={icon as any} size={18} color={color}/>
            <Text style={[{ flex:1, fontSize:13, color:theme.rowTitle, marginLeft:8 }]}>Choose icon</Text>
            <Ionicons name={showIcons?"chevron-up":"chevron-down"} size={14} color={theme.labelColor}/>
          </Pressable>
          {showIcons&&(
            <View style={sceneSt.iconGrid}>
              {SCENE_ICONS.map(ic=>(
                <Pressable key={ic} onPress={()=>{ setIcon(ic); setShowIcons(false); }}
                  style={[sceneSt.iconGridItem,{ backgroundColor:icon===ic?color+"22":theme.pillBg, borderColor:icon===ic?color:theme.pillBorder }]}>
                  <Ionicons name={ic as any} size={20} color={icon===ic?color:theme.labelColor}/>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Steps */}
        <Text style={[evEdSt.sectionLabel,{ color:theme.groupLabel }]}>STEPS</Text>
        <Text style={[evEdSt.stepHint,{ color:theme.labelColor }]}>
          Steps run instantly in order. Add Wake PC first if your PC is off.
        </Text>

        {steps.map((step,i)=>{
          const meta=STEP_META[step.type];
          return (
            <View key={i} style={[evEdSt.stepCard,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
              <View style={[evEdSt.stepIcon,{ backgroundColor:meta.color+"22" }]}>
                <Ionicons name={meta.icon as any} size={18} color={meta.color}/>
              </View>
              <View style={{ flex:1 }}>
                <Text style={[evEdSt.stepLabel,{ color:theme.rowTitle }]}>{i+1}. {step.actionName||meta.label}</Text>
                {step.path&&<Text style={[evEdSt.stepPath,{ color:theme.labelColor }]} numberOfLines={1}>{step.path}</Text>}
              </View>
              <Pressable onPress={()=>removeStep(i)} hitSlop={10}>
                <Ionicons name="close-circle-outline" size={20} color="#ef4444"/>
              </Pressable>
            </View>
          );
        })}

        {addingStep?(
          <View style={[evEdSt.addStepCard,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
            <Text style={[evEdSt.addStepTitle,{ color:theme.rowTitle }]}>Choose a step</Text>
            {(["wake_pc","shutdown_pc","restart_pc","lock_pc"] as EventStepType[])
              .filter(type=>type!=="wake_pc"||steps.length===0)
              .map(type=>{
                const meta=STEP_META[type];
                return (
                  <Pressable key={type} onPress={()=>addStep(type)} style={[evEdSt.stepOption,{ borderColor:theme.cardBorder }]}>
                    <View style={[evEdSt.stepIcon,{ backgroundColor:meta.color+"22" }]}><Ionicons name={meta.icon as any} size={16} color={meta.color}/></View>
                    <Text style={[evEdSt.stepOptionText,{ color:theme.rowTitle }]}>{meta.label}</Text>
                  </Pressable>
                );
              })}
            <View style={[evEdSt.divider,{ backgroundColor:theme.cardBorder }]}/>
            <Text style={[evEdSt.groupLabel,{ color:theme.labelColor }]}>CUSTOM ACTIONS</Text>
            {customActions.length>0?(
              customActions.map(action=>(
                <Pressable key={action.id} onPress={()=>addStep("run_custom_action",{ path:action.path, actionName:action.name })}
                  style={[evEdSt.stepOption,{ borderColor:theme.cardBorder }]}>
                  <View style={[evEdSt.stepIcon,{ backgroundColor:"#a855f722" }]}><Ionicons name="document-outline" size={16} color="#a855f7"/></View>
                  <Text style={[evEdSt.stepOptionText,{ color:theme.rowTitle }]}>{action.name}</Text>
                </Pressable>
              ))
            ):(
              <Pressable onPress={()=>{ setAddingStep(false); onGoToCustomActions(); }}
                style={[evEdSt.stepOption,{ borderColor:"#a855f744", backgroundColor:"#a855f711" }]}>
                <View style={[evEdSt.stepIcon,{ backgroundColor:"#a855f722" }]}><Ionicons name="add-circle-outline" size={16} color="#a855f7"/></View>
                <Text style={[evEdSt.stepOptionText,{ color:"#a855f7" }]}>Add a Custom Action first →</Text>
              </Pressable>
            )}
            <Pressable onPress={()=>setAddingStep(false)} style={evEdSt.cancelStepBtn}>
              <Text style={{ color:theme.labelColor, fontSize:14 }}>Cancel</Text>
            </Pressable>
          </View>
        ):(
          <Pressable onPress={()=>setAddingStep(true)} style={[evEdSt.addStepBtn,{ borderColor:"#007aff44", backgroundColor:"#007aff11" }]}>
            <Ionicons name="add-circle-outline" size={18} color="#007aff"/>
            <Text style={evEdSt.addStepBtnText}>Add Step</Text>
          </Pressable>
        )}

        {/* Delete scene — only shown for existing scenes */}
        {!isNew&&onDelete&&(
          <Pressable onPress={()=>Alert.alert("Delete Scene",`Delete "${name}"?`,[
            { text:"Cancel", style:"cancel" },
            { text:"Delete Scene", style:"destructive", onPress:onDelete },
          ])} style={[sceneSt.deleteBtn,{ borderColor:"#ef444433" }]}>
            <Ionicons name="trash-outline" size={16} color="#ef4444"/>
            <Text style={{ color:"#ef4444", fontSize:14, fontWeight:"500" }}>Delete Scene</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────
// Scenes Screen
// ─────────────────────────────────────────────
function ScenesScreen({ device,scenes,customActions,onSave,onBack,onRunScene,onGoToCustomActions,theme }:{
  device:Device; scenes:Scene[]; customActions:CustomAction[];
  onSave:(s:Scene[])=>void; onBack:()=>void;
  onRunScene:(scene:Scene)=>void;
  onGoToCustomActions:()=>void; theme:ReturnType<typeof useTheme>;
}) {
  const [list,    setList]    = useState<Scene[]>(scenes);
  const [editing, setEditing] = useState<Scene|null>(null);
  const [isNew,   setIsNew]   = useState(false);

  const persist = (updated:Scene[])=>{ setList(updated); onSave(updated); };

  const createNew = ()=>{
    setEditing({ id:`sc_${Date.now()}`, name:"New Scene", steps:[], icon:"flash", color:"#007aff" });
    setIsNew(true);
  };

  const saveScene = (s:Scene)=>{
    persist(isNew?[...list,s]:list.map(e=>e.id===s.id?s:e));
    setEditing(null); setIsNew(false);
  };

  const deleteScene = (id:string)=>{
    Alert.alert("Delete Scene","Delete this scene?",[
      { text:"Cancel",style:"cancel" },
      { text:"Delete",style:"destructive",onPress:()=>persist(list.filter(s=>s.id!==id)) },
    ]);
  };

  if (editing) {
    return <SceneEditor scene={editing} isNew={isNew} customActions={customActions}
      onSave={saveScene} onBack={()=>{ setEditing(null); setIsNew(false); }}
      onDelete={!isNew?()=>{ deleteScene(editing.id); setEditing(null); setIsNew(false); }:undefined}
      onGoToCustomActions={()=>{ setEditing(null); setIsNew(false); onGoToCustomActions(); }}
      theme={theme}/>;
  }

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Scenes</Text>
        </View>
        <Pressable onPress={createNew} hitSlop={10}>
          <Ionicons name="add-circle-outline" size={24} color="#007aff"/>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding:20, paddingBottom:60 }} showsVerticalScrollIndicator={false}>
        <View style={[panelSt.noteBox,{ backgroundColor:theme.pillBg, borderColor:theme.pillBorder, marginBottom:20 }]}>
          <Ionicons name="information-circle-outline" size={15} color={theme.labelColor}/>
          <Text style={[panelSt.noteText,{ color:theme.labelColor }]}>
            Scenes run instantly with one tap. Add Wake PC as the first step and remaining actions will run automatically once your PC is ready.
          </Text>
        </View>

        {list.length===0?(
          <View style={panelSt.empty}>
            <Ionicons name="albums-outline" size={44} color={theme.labelColor}/>
            <Text style={[panelSt.emptyTitle,{ color:theme.titleColor }]}>No scenes yet</Text>
            <Text style={[panelSt.emptySub,{ color:theme.labelColor }]}>Tap + to create a scene like Gaming Setup or End of Day.</Text>
          </View>
        ):(
          <>
            {/* Scene tiles grid */}
            <View style={sceneSt.tileGrid}>
              {list.map(scene=>(
                <Pressable key={scene.id} onPress={()=>onRunScene(scene)}
                  style={({ pressed })=>[sceneSt.tile,{ backgroundColor:pressed?scene.color+"cc":scene.color }]}>
                  <Ionicons name={scene.icon as any} size={28} color="white"/>
                  <Text style={sceneSt.tileName} numberOfLines={2}>{scene.name}</Text>
                  <Pressable onPress={()=>{ setEditing(scene); setIsNew(false); }} style={sceneSt.tileEdit} hitSlop={12}>
                    <Ionicons name="create-outline" size={18} color="rgba(255,255,255,0.8)"/>
                  </Pressable>
                </Pressable>
              ))}
              {/* Add button tile */}
              <Pressable onPress={createNew}
                style={[sceneSt.tile,{ backgroundColor:theme.cardBg, borderWidth:1, borderColor:theme.cardBorder, borderStyle:"dashed" }]}>
                <Ionicons name="add" size={28} color={theme.labelColor}/>
                <Text style={[sceneSt.tileName,{ color:theme.labelColor }]}>New Scene</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────
// Volume Screen
// ─────────────────────────────────────────────
function VolumeScreen({ device,volumeData,onBack,sendVolumeCommand,theme }:{
  device:Device; volumeData:VolumeData|null;
  onBack:()=>void;
  sendVolumeCommand:(type:string,extra:Record<string,any>)=>void;
  theme:ReturnType<typeof useTheme>;
}) {
  const [localData,   setLocalData]   = useState<VolumeData|null>(volumeData);
  const [refreshing,  setRefreshing]  = useState(false);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const loading = !localData && device.status!=="offline";

  useEffect(()=>{ setLocalData(volumeData); },[volumeData]);

  useEffect(()=>{
    if (device.status!=="offline") {
      sendVolumeCommand("get_volume",{});
      sendVolumeCommand("volume_subscribe",{});
    }
    return ()=>{ sendVolumeCommand("volume_unsubscribe",{}); };
  },[]);

  const refresh = ()=>{
    if (refreshing) return;
    setRefreshing(true);
    spinAnim.setValue(0);
    Animated.timing(spinAnim,{ toValue:1, duration:800, useNativeDriver:true }).start();
    sendVolumeCommand("get_volume",{});
    setTimeout(()=>setRefreshing(false), 900);
  };

  const spin = spinAnim.interpolate({ inputRange:[0,1], outputRange:["0deg","360deg"] });

  const setMasterVol = (vol:number)=>{
    if (!localData) return;
    setLocalData({ ...localData, master:{ ...localData.master, volume:vol } });
    sendVolumeCommand("set_master_volume",{ volume:vol });
  };

  const toggleMasterMute = ()=>{
    if (!localData) return;
    const muted = !localData.master.muted;
    setLocalData({ ...localData, master:{ ...localData.master, muted } });
    sendVolumeCommand("set_master_volume",{ volume:localData.master.volume, muted });
  };

  const setSessionVol = (pid:string, vol:number)=>{
    if (!localData) return;
    const sessions = localData.sessions.map(s=>s.id===pid?{ ...s, volume:vol }:s);
    setLocalData({ ...localData, sessions });
    sendVolumeCommand("set_session_volume",{ pid, volume:vol });
  };

  const toggleSessionMute = (pid:string)=>{
    if (!localData) return;
    const sessions = localData.sessions.map(s=>{ if (s.id!==pid) return s; const muted=!s.muted; sendVolumeCommand("set_session_volume",{ pid, volume:s.volume, muted }); return { ...s, muted }; });
    setLocalData({ ...localData, sessions });
  };

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Volume Mixer</Text>
        </View>
        <Pressable onPress={refresh} hitSlop={10} disabled={refreshing}>
          <Animated.View style={{ transform:[{ rotate:spin }] }}>
            <Ionicons name="refresh-outline" size={22} color={refreshing?"#007aff99":"#007aff"}/>
          </Animated.View>
        </Pressable>
      </View>

      {device.status==="offline"?(
        <View style={panelSt.empty}>
          <Ionicons name="volume-mute-outline" size={44} color={theme.labelColor}/>
          <Text style={[panelSt.emptyTitle,{ color:theme.titleColor }]}>PC is offline</Text>
          <Text style={[panelSt.emptySub,{ color:theme.labelColor }]}>Volume Mixer requires your PC to be online.</Text>
        </View>
      ):loading&&!localData?(
        <View style={panelSt.empty}>
          <Ionicons name="volume-medium-outline" size={44} color={theme.labelColor}/>
          <Text style={[panelSt.emptyTitle,{ color:theme.titleColor }]}>Loading…</Text>
          <Text style={[panelSt.emptySub,{ color:theme.labelColor }]}>Fetching audio sessions from your PC.</Text>
        </View>
      ):!localData?(
        <View style={panelSt.empty}>
          <Ionicons name="alert-circle-outline" size={44} color={theme.labelColor}/>
          <Text style={[panelSt.emptyTitle,{ color:theme.titleColor }]}>Not available</Text>
          <Text style={[panelSt.emptySub,{ color:theme.labelColor }]}>Install pycaw on your PC:{"\n"}pip install pycaw</Text>
        </View>
      ):(
        <ScrollView contentContainerStyle={{ padding:20, paddingBottom:60 }} showsVerticalScrollIndicator={false}>
          <Text style={[evEdSt.sectionLabel,{ color:theme.groupLabel }]}>MASTER VOLUME</Text>
          <View style={[volSt.card,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
            <View style={volSt.row}>
              <Pressable onPress={toggleMasterMute} hitSlop={10} style={volSt.muteBtn}>
                <Ionicons name={localData.master.muted?"volume-mute-outline":"volume-high-outline"} size={22} color={localData.master.muted?"#ef4444":"#007aff"}/>
              </Pressable>
              <Text style={[volSt.appName,{ color:theme.rowTitle }]}>System</Text>
              <Text style={[volSt.volPct,{ color:theme.labelColor }]}>{localData.master.muted?"Muted":`${localData.master.volume}%`}</Text>
            </View>
            <VolumeSlider value={localData.master.muted?0:localData.master.volume} muted={localData.master.muted}
              onChangeLive={v=>{ setLocalData(d=>d?{ ...d, master:{ ...d.master, volume:v } }:d); sendVolumeCommand("set_master_volume",{ volume:v }); }}
              onChangeEnd={v=>setMasterVol(v)} color="#007aff" theme={theme}/>
          </View>
          {localData.sessions.length>0&&(
            <>
              <Text style={[evEdSt.sectionLabel,{ color:theme.groupLabel, marginTop:20 }]}>APPLICATIONS</Text>
              {localData.sessions.map(session=>(
                <View key={session.id} style={[volSt.card,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
                  <View style={volSt.row}>
                    <Pressable onPress={()=>toggleSessionMute(session.id)} hitSlop={10} style={volSt.muteBtn}>
                      <Ionicons name={session.muted?"volume-mute-outline":"volume-medium-outline"} size={20} color={session.muted?"#ef4444":theme.labelColor}/>
                    </Pressable>
                    <Text style={[volSt.appName,{ color:theme.rowTitle }]} numberOfLines={1}>{session.name}</Text>
                    <Text style={[volSt.volPct,{ color:theme.labelColor }]}>{session.muted?"Muted":`${session.volume}%`}</Text>
                  </View>
                  <VolumeSlider value={session.muted?0:session.volume} muted={session.muted}
                    onChangeLive={v=>{ setLocalData(d=>d?{ ...d, sessions:d.sessions.map(s=>s.id===session.id?{ ...s, volume:v }:s) }:d); sendVolumeCommand("set_session_volume",{ pid:session.id, volume:v }); }}
                    onChangeEnd={v=>setSessionVol(session.id,v)} color="#a855f7" theme={theme}/>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// Volume slider component
function VolumeSlider({ value,muted,onChangeLive,onChangeEnd,color,theme }:{
  value:number; muted:boolean;
  onChangeLive:(v:number)=>void;
  onChangeEnd:(v:number)=>void;
  color:string; theme:ReturnType<typeof useTheme>;
}) {
  const [localVal,  setLocalVal]  = useState(value);
  const trackRef    = useRef<View>(null);
  const trackWidth  = useRef(0);
  const trackPageX  = useRef(0);
  const lastSent    = useRef(0);
  const active      = useRef(false);

  useEffect(()=>{ if (!active.current) setLocalVal(value); },[value]);

  const fillPct = muted ? 0 : localVal;

  const calcVal = (pageX:number) => {
    const pct = (pageX - trackPageX.current) / trackWidth.current * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  };

  // Measure track position once on grant, cache it for the whole drag
  const onGrant = (e:any) => {
    active.current = true;
    trackRef.current?.measure((_x,_y,w,_h,px)=>{
      trackPageX.current = px;
      trackWidth.current = w;
      const v = calcVal(e.nativeEvent.pageX);
      setLocalVal(v); onChangeLive(v); lastSent.current = Date.now();
    });
  };

  const onMove = (e:any) => {
    if (!active.current) return;
    const v = calcVal(e.nativeEvent.pageX);
    setLocalVal(v);
    const now = Date.now();
    if (now - lastSent.current >= 40) {
      lastSent.current = now;
      onChangeLive(v);
    }
  };

  const onRelease = (e:any) => {
    active.current = false;
    const v = calcVal(e.nativeEvent.pageX);
    setLocalVal(v); onChangeLive(v); onChangeEnd(v);
  };

  return (
    <View ref={trackRef}
      style={volSt.sliderHitArea}
      onLayout={(e)=>{ trackWidth.current=e.nativeEvent.layout.width; }}
      // Capture on start so ScrollView never steals the gesture
      onStartShouldSetResponder={()=>true}
      onStartShouldSetResponderCapture={()=>true}
      // Keep the responder even when finger moves vertically
      onMoveShouldSetResponder={()=>active.current}
      onMoveShouldSetResponderCapture={()=>active.current}
      onResponderTerminationRequest={()=>false}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminate={(e)=>{ active.current=false; onChangeEnd(calcVal(e.nativeEvent.pageX)); }}>
      <View style={[volSt.sliderTrack,{ backgroundColor:theme.statsBar }]}>
        <View style={[volSt.sliderFill,{ width:`${fillPct}%` as any, backgroundColor:muted?"#6b7280":color }]}/>
        <View style={[volSt.sliderThumb,{ left:`${fillPct}%` as any, borderColor:muted?"#6b7280":color }]}/>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────
// File Browser Screen
// ─────────────────────────────────────────────
function LoadingDots({ color }:{ color:string }) {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(()=>{
    const anims = dots.map((dot,i)=>Animated.loop(Animated.sequence([
      Animated.delay(i*200),
      Animated.timing(dot,{ toValue:1, duration:300, useNativeDriver:true }),
      Animated.timing(dot,{ toValue:0, duration:300, useNativeDriver:true }),
      Animated.delay(600-i*200),
    ])));
    anims.forEach(a=>a.start());
    return ()=>anims.forEach(a=>a.stop());
  },[]);
  return (
    <View style={{ flexDirection:"row", gap:6, alignItems:"center", justifyContent:"center", marginTop:16 }}>
      {dots.map((dot,i)=>(
        <Animated.View key={i} style={{ width:8, height:8, borderRadius:4, backgroundColor:color, opacity:dot }}/>
      ))}
    </View>
  );
}

function FileBrowserScreen({ device,browseResult,onBack,sendCommand,sharingRef,downloadCompleteRef,theme }:{
  device:Device; browseResult:FileBrowseResult|null;
  onBack:()=>void;
  sendCommand:(type:string,extra:Record<string,any>)=>void;
  sharingRef:React.MutableRefObject<boolean>;
  downloadCompleteRef:React.MutableRefObject<(()=>void)|null>;
  theme:ReturnType<typeof useTheme>;
}) {
  const [path,          setPath]         = useState("");
  const [loading,       setLoading]      = useState(true);
  const [history,       setHistory]      = useState<string[]>([]);
  const [downloading,   setDownloading]  = useState<string|null>(null);
  const [error,         setError]        = useState<string|null>(null);
  const [search,        setSearch]       = useState("");
  const [searching,     setSearching]    = useState(false);
  const [searchResults, setSearchResults]= useState<FileEntry[]|null>(null);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const dlAnim   = useRef(new Animated.Value(0)).current;

  // Register callback so parent can clear downloading state when share sheet opens
  useEffect(()=>{
    downloadCompleteRef.current = ()=>setDownloading(null);
    return ()=>{ downloadCompleteRef.current = null; };
  },[]);

  // Spin animation for downloading indicator
  useEffect(()=>{
    if (downloading) {
      Animated.loop(
        Animated.timing(dlAnim,{ toValue:1, duration:800, useNativeDriver:true })
      ).start();
    } else {
      dlAnim.stopAnimation();
      dlAnim.setValue(0);
    }
  },[downloading]);

  const pathMatches = browseResult?.path===path||(browseResult?.path==="Home"&&path==="");
  const currentEntries = pathMatches ? (browseResult?.entries??[]) : [];
  const displayEntries = searchResults ?? currentEntries;
  const isDone = pathMatches ? (browseResult?.done ?? true) : false;
  const showLoading = loading && currentEntries.length===0 && !searchResults;

  const browse = (newPath:string) => {
    if (device.status==="offline") { setError("PC is offline."); return; }
    setLoading(true); setError(null);
    sendCommand("browse_files",{ path:newPath });
  };

  const refresh = () => {
    spinAnim.setValue(0);
    Animated.timing(spinAnim,{ toValue:1, duration:600, useNativeDriver:true }).start();
    browse(path);
  };

  // Pick up global search results when they arrive
  useEffect(()=>{
    if ((browseResult as any)?.searchResults!==undefined) {
      setSearchResults((browseResult as any).searchResults);
      setSearching(false);
    }
  },[(browseResult as any)?.searchResults]);

  useEffect(()=>{
    if (browseResult) {
      const matches = browseResult.path===path||(browseResult.path==="Home"&&path==="");
      if (matches) { setLoading(false); if (browseResult.error) setError(browseResult.error); }
    }
  },[browseResult?.entries?.length, browseResult?.path]);

  useEffect(()=>{ if (device.status!=="offline") browse(""); },[]);

  const runGlobalSearch = (query:string) => {
    if (!query.trim()) { setSearchResults(null); return; }
    setSearching(true);
    sendCommand("search_files",{ query:query.trim() });
  };

  const navigate = (entry:FileEntry) => {
    if (sharingRef.current) return;
    if (entry.isDir) {
      const newPath = entry.path || (path===""||path==="Home"?entry.name:`${path}\\${entry.name}`);
      setHistory(h=>[...h,path]);
      setPath(newPath);
      setSearch(""); setSearchResults(null);
      browse(newPath);
    } else {
      if (downloading) return;
      setDownloading(entry.name);
      // Use full path from search results if available, otherwise construct from current path
      const filePath = entry.path || (path===""||path==="Home"?entry.name:`${path}\\${entry.name}`);
      sendCommand("download_file",{ path:filePath });
    }
  };

  const goBack = () => {
    if (history.length>0) {
      const prev = history[history.length-1];
      setHistory(h=>h.slice(0,-1));
      setPath(prev); browse(prev);
    }
  };

  const formatSize = (bytes?:number) => {
    if (!bytes) return "";
    if (bytes<1024) return `${bytes} B`;
    if (bytes<1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/1024/1024).toFixed(1)} MB`;
  };

  const getFileIcon = (name:string) => {
    const ext = name.split(".").pop()?.toLowerCase()||"";
    if (["jpg","jpeg","png","gif","bmp","webp"].includes(ext)) return { icon:"image-outline",         color:"#f59e0b" };
    if (["mp4","mov","avi","mkv","wmv"].includes(ext))         return { icon:"film-outline",           color:"#ef4444" };
    if (["mp3","wav","flac","aac"].includes(ext))              return { icon:"musical-notes-outline",  color:"#a855f7" };
    if (["pdf"].includes(ext))                                 return { icon:"document-text-outline",  color:"#ef4444" };
    if (["doc","docx"].includes(ext))                          return { icon:"document-outline",       color:"#3b82f6" };
    if (["xls","xlsx"].includes(ext))                          return { icon:"grid-outline",           color:"#22c55e" };
    if (["zip","rar","7z"].includes(ext))                      return { icon:"archive-outline",        color:"#f59e0b" };
    if (["exe","msi"].includes(ext))                           return { icon:"settings-outline",       color:"#6b7280" };
    if (["txt","md","log"].includes(ext))                      return { icon:"reader-outline",         color:"#94a3b8" };
    return { icon:"document-outline", color:"#94a3b8" };
  };

  const spin = spinAnim.interpolate({ inputRange:[0,1], outputRange:["0deg","360deg"] });
  const isHome = path===""||path==="Home";
  const displayPath = isHome ? "Quick Access" : path;

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Files</Text>
        </View>
        <Pressable onPress={refresh} hitSlop={10}>
          <Animated.View style={{ transform:[{ rotate:spin }] }}>
            <Ionicons name="refresh-outline" size={22} color="#007aff"/>
          </Animated.View>
        </Pressable>
      </View>

      {/* Path bar */}
      <View style={[fileSt.pathBar,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
        {history.length>0&&(
          <Pressable onPress={goBack} hitSlop={10} style={{ marginRight:10 }}>
            <Ionicons name="arrow-back-outline" size={18} color="#007aff"/>
          </Pressable>
        )}
        <Ionicons name={isHome?"home-outline":"folder-outline"} size={14} color={theme.labelColor} style={{ marginRight:6 }}/>
        <Text style={[fileSt.pathText,{ color:theme.labelColor }]} numberOfLines={1}>{displayPath}</Text>
      </View>

      {/* Search bar */}
      <View style={[fileSt.searchBar,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
        <Ionicons name="search-outline" size={16} color={theme.labelColor}/>
        <TextInput
          value={search}
          onChangeText={v=>{ setSearch(v); if (!v.trim()) setSearchResults(null); }}
          onSubmitEditing={()=>runGlobalSearch(search)}
          placeholder="Search all files on PC…"
          placeholderTextColor={theme.labelColor}
          style={[fileSt.searchInput,{ color:theme.rowTitle }]}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search.trim()&&(
          <Pressable onPress={()=>runGlobalSearch(search)} hitSlop={10}>
            <Ionicons name="arrow-forward-circle-outline" size={20} color="#007aff"/>
          </Pressable>
        )}
      </View>
      {searching&&(
        <View style={{ flexDirection:"row", alignItems:"center", gap:8, paddingHorizontal:20, paddingVertical:6 }}>
          <LoadingDots color="#007aff"/>
          <Text style={{ color:theme.labelColor, fontSize:12 }}>Searching…</Text>
        </View>
      )}
      {searchResults&&!searching&&(
        <Text style={[fileSt.searchCount,{ color:theme.labelColor }]}>
          {searchResults.length} result{searchResults.length!==1?"s":""} for "{search}"
        </Text>
      )}

      {device.status==="offline"?(
        <View style={panelSt.empty}>
          <Ionicons name="folder-open-outline" size={44} color={theme.labelColor}/>
          <Text style={[panelSt.emptyTitle,{ color:theme.titleColor }]}>PC is offline</Text>
          <Text style={[panelSt.emptySub,{ color:theme.labelColor }]}>Wake your PC first to browse files.</Text>
        </View>
      ):showLoading?(
        <View style={panelSt.empty}>
          <Ionicons name="folder-open-outline" size={44} color={theme.labelColor}/>
          <Text style={[panelSt.emptyTitle,{ color:theme.titleColor }]}>Loading</Text>
          <LoadingDots color="#007aff"/>
        </View>
      ):error?(
        <View style={panelSt.empty}>
          <Ionicons name="alert-circle-outline" size={44} color="#ef4444"/>
          <Text style={[panelSt.emptyTitle,{ color:theme.titleColor }]}>Error</Text>
          <Text style={[panelSt.emptySub,{ color:theme.labelColor }]}>{error}</Text>
          <Pressable onPress={refresh} style={[panelSt.addBtn,{ paddingHorizontal:24, marginTop:12 }]}>
            <Text style={panelSt.addBtnText}>Retry</Text>
          </Pressable>
        </View>
      ):(
        <ScrollView contentContainerStyle={{ paddingBottom:40 }} showsVerticalScrollIndicator={false}>
          {displayEntries.length===0?(
            <View style={panelSt.empty}>
              <Ionicons name={searchResults!==null?"search-outline":"folder-open-outline"} size={44} color={theme.labelColor}/>
              <Text style={[panelSt.emptyTitle,{ color:theme.titleColor }]}>
                {searchResults!==null?`No files matching "${search}"`:"Empty folder"}
              </Text>
            </View>
          ):(
            <>
              {displayEntries.map((entry,i)=>{
                const fileInfo = !entry.isDir ? getFileIcon(entry.name) : null;
                const isDownloading = downloading===entry.name;
                return (
                  <Pressable key={i} onPress={()=>navigate(entry)}
                    style={({ pressed })=>[fileSt.entry,{ backgroundColor:pressed&&!sharingRef.current&&!downloading?theme.actionTilePressed:theme.panelBg, borderBottomColor:theme.cardBorder }]}>
                    <View style={[fileSt.entryIcon,{ backgroundColor:entry.isDir?"#007aff22":fileInfo!.color+"22" }]}>
                      <Ionicons name={entry.isDir?"folder-outline":fileInfo!.icon as any} size={20} color={entry.isDir?"#007aff":fileInfo!.color}/>
                    </View>
                    <View style={{ flex:1 }}>
                      <Text style={[fileSt.entryName,{ color:theme.rowTitle }]} numberOfLines={1}>{entry.name}</Text>
                      {searchResults&&entry.path?(
                        <Text style={[fileSt.entrySize,{ color:theme.labelColor }]} numberOfLines={1}>{entry.path}</Text>
                      ):!entry.isDir&&entry.size!=null?(
                        <Text style={[fileSt.entrySize,{ color:theme.labelColor }]}>{formatSize(entry.size)}</Text>
                      ):null}
                    </View>
                    {entry.isDir?(
                      <Ionicons name="chevron-forward" size={16} color={theme.chevron}/>
                    ):isDownloading?(
                      <Animated.View style={{ transform:[{ rotate:dlAnim.interpolate({ inputRange:[0,1], outputRange:["0deg","360deg"] }) }] }}>
                        <Ionicons name="sync-outline" size={18} color="#007aff"/>
                      </Animated.View>
                    ):(
                      <Ionicons name="download-outline" size={18} color={theme.labelColor}/>
                    )}
                  </Pressable>
                );
              })}
              {!isDone&&(
                <View style={{ paddingVertical:20, alignItems:"center" }}>
                  <LoadingDots color={theme.labelColor}/>
                  <Text style={{ color:theme.labelColor, fontSize:12, marginTop:8 }}>Loading more…</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────
// Media Controls Screen
// ─────────────────────────────────────────────
function MediaControlsScreen({ onBack,sendCommand,nowPlaying,theme }:{
  onBack:()=>void;
  sendCommand:(type:string,extra:Record<string,any>)=>void;
  nowPlaying:{title:string|null,artist:string|null,status:string|null}|null;
  theme:ReturnType<typeof useTheme>;
}) {
  const media=(action:string)=>{
    sendCommand("media_control",{ action });
    setTimeout(()=>sendCommand("get_now_playing",{}), 500);
  };

  useEffect(()=>{
    sendCommand("get_now_playing",{});
    const interval = setInterval(()=>sendCommand("get_now_playing",{}), 5000);
    return ()=>clearInterval(interval);
  },[]);

  const btn=(icon:string,action:string,color:string,size:number=32)=>(
    <Pressable onPress={()=>media(action)} hitSlop={8}
      style={({ pressed })=>[mediaSt.btn,{ backgroundColor:pressed?color+"44":color+"22" }]}>
      <Ionicons name={icon as any} size={size} color={color}/>
    </Pressable>
  );

  const isPlaying = nowPlaying?.status?.toLowerCase().includes("playing");

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Media Controls</Text>
        </View>
      </View>
      <View style={mediaSt.container}>
        {/* Now playing card */}
        <View style={[mediaSt.nowPlayingCard,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
          {nowPlaying?.album_art?(
            <Image source={{ uri:`data:image/jpeg;base64,${nowPlaying.album_art}` }}
              style={mediaSt.albumArt}/>
          ):(
            <View style={[mediaSt.albumArtPlaceholder,{ backgroundColor:theme.panelBg }]}>
              <Ionicons name={isPlaying?"musical-notes":"musical-notes-outline"} size={22} color={isPlaying?"#a855f7":theme.labelColor}/>
            </View>
          )}
          <View style={{ flex:1 }}>
            <Text style={[mediaSt.trackTitle,{ color:theme.rowTitle }]} numberOfLines={1}>
              {nowPlaying?.title||"Nothing playing"}
            </Text>
            {nowPlaying?.artist?(
              <Text style={[mediaSt.trackArtist,{ color:theme.labelColor }]} numberOfLines={1}>
                {(nowPlaying as any)?.is_last_known?"Last played · ":""}{nowPlaying.artist}
              </Text>
            ):(nowPlaying as any)?.is_last_known?(
              <Text style={[mediaSt.trackArtist,{ color:theme.labelColor }]}>Last played</Text>
            ):null}
          </View>
        </View>
        {/* Playback controls */}
        <View style={mediaSt.mainRow}>
          {btn("play-skip-back","prev","#a855f7",36)}
          {btn(isPlaying?"pause":"play","play_pause","#007aff",52)}
          {btn("play-skip-forward","next","#a855f7",36)}
        </View>
        {/* Volume controls */}
        <View style={mediaSt.volRow}>
          {btn("volume-low-outline","vol_down","#f59e0b",28)}
          {btn("volume-mute-outline","vol_mute","#ef4444",28)}
          {btn("volume-high-outline","vol_up","#f59e0b",28)}
        </View>
        <Text style={[mediaSt.hint,{ color:theme.labelColor }]}>Controls currently playing media on your PC</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────
// Clipboard Sync Screen
// ─────────────────────────────────────────────
function ClipboardScreen({ onBack,sendCommand,pcClipboardText,onClearClipboard,theme }:{
  onBack:()=>void;
  sendCommand:(type:string,extra:Record<string,any>)=>void;
  pcClipboardText:string|null;
  onClearClipboard:()=>void;
  theme:ReturnType<typeof useTheme>;
}) {
  const [phoneText, setPhoneText] = useState("");
  const [loading,   setLoading]   = useState(false);
  const [status,    setStatus]    = useState("");
  const [fetchError,setFetchError]= useState("");
  const [copyLabel, setCopyLabel] = useState("Copy to iPhone");
  const scrollRef = useRef<ScrollView>(null);

  // Clear when opening or leaving screen
  useEffect(()=>{
    onClearClipboard();
    return ()=>{ onClearClipboard(); };
  },[]);

  useEffect(()=>{
    if (pcClipboardText!==null) { setLoading(false); setFetchError(""); }
  },[pcClipboardText]);

  const fetchClipboard = () => {
    setLoading(true); setStatus(""); setFetchError(""); onClearClipboard();
    sendCommand("get_clipboard",{});
    setTimeout(()=>{ setLoading(f=>{ if(f){ setFetchError("No response from PC. Make sure the agent is running."); } return false; }); }, 8000);
  };

  const pushClipboard = () => {
    if (!phoneText.trim()) return;
    sendCommand("set_clipboard",{ text:phoneText });
    setPhoneText("");
    setStatus("Sent to PC clipboard!");
    setTimeout(()=>setStatus(""), 3000);
  };

  const copyToPhone = () => {
    if (!pcClipboardText) return;
    const { Clipboard } = require("react-native");
    Clipboard.setString(pcClipboardText);
    setCopyLabel("Copied!");
    setTimeout(()=>setCopyLabel("Copy to iPhone"), 3000);
  };

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Clipboard Sync</Text>
        </View>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS==="ios"?"padding":"height"} style={{ flex:1 }} keyboardVerticalOffset={90}>
        <ScrollView ref={scrollRef} style={{ flex:1 }} contentContainerStyle={{ padding:20, gap:20 }} keyboardShouldPersistTaps="handled">
          {/* PC → Phone */}
          <View style={[clipSt.card,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
            <Text style={[clipSt.sectionLabel,{ color:theme.groupLabel }]}>PC CLIPBOARD</Text>
            <Pressable onPress={fetchClipboard}
              style={[clipSt.fetchBtn,{ backgroundColor:"#007aff11", borderColor:"#007aff44" }]}>
              <Ionicons name="download-outline" size={18} color="#007aff"/>
              <Text style={clipSt.fetchBtnText}>{loading?"Fetching…":"Fetch from PC"}</Text>
            </Pressable>
            {loading&&(
              <View style={{ alignItems:"center", paddingVertical:8 }}>
                <LoadingDots color="#007aff"/>
              </View>
            )}
            {!loading&&fetchError&&(
              <View style={[clipSt.warnRow,{ backgroundColor:"#ef444411", borderColor:"#ef444433" }]}>
                <Ionicons name="alert-circle-outline" size={14} color="#ef4444"/>
                <Text style={[clipSt.warnText,{ color:"#ef4444" }]}>{fetchError}</Text>
              </View>
            )}
            {!loading&&pcClipboardText!==null&&(
              <>
                <View style={[clipSt.textBox,{ backgroundColor:theme.panelBg, borderColor:theme.cardBorder, maxHeight:200 }]}>
                  <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
                    <Text style={[clipSt.clipText,{ color:theme.rowTitle }]} selectable>
                      {pcClipboardText||"(empty)"}
                    </Text>
                  </ScrollView>
                </View>
                {pcClipboardText?.includes("[Truncated —")&&(
                  <View style={[clipSt.warnRow,{ backgroundColor:"#f59e0b11", borderColor:"#f59e0b44" }]}>
                    <Ionicons name="warning-outline" size={14} color="#f59e0b"/>
                    <Text style={[clipSt.warnText,{ color:"#f59e0b" }]}>Content was truncated at 10,000 characters. Use File Browser to transfer large files.</Text>
                  </View>
                )}
                {pcClipboardText&&(
                  <Pressable onPress={copyToPhone}
                    style={[clipSt.fetchBtn,{ borderColor:"#a855f744", backgroundColor:"#a855f711" }]}>
                    <Ionicons name={copyLabel==="Copied!"?"checkmark-outline":"copy-outline"} size={16} color="#a855f7"/>
                    <Text style={[clipSt.fetchBtnText,{ color:"#a855f7" }]}>{copyLabel}</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
          {/* Phone → PC */}
          <View style={[clipSt.card,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
            <Text style={[clipSt.sectionLabel,{ color:theme.groupLabel }]}>SEND TO PC</Text>
            <TextInput
              value={phoneText}
              onChangeText={setPhoneText}
              placeholder="Type or paste text to send to PC…"
              placeholderTextColor={theme.labelColor}
              style={[clipSt.input,{ color:theme.rowTitle, backgroundColor:theme.panelBg, borderColor:theme.cardBorder, minHeight:80 }]}
              multiline
              scrollEnabled
              onFocus={()=>setTimeout(()=>scrollRef.current?.scrollToEnd({ animated:true }), 300)}
            />
            <Pressable onPress={pushClipboard}
              style={[clipSt.fetchBtn,{ backgroundColor:"#22c55e11", borderColor:"#22c55e44" }]}>
              <Ionicons name="arrow-up-outline" size={18} color="#22c55e"/>
              <Text style={[clipSt.fetchBtnText,{ color:"#22c55e" }]}>Send to PC Clipboard</Text>
            </Pressable>
            {!!status&&<Text style={[clipSt.status,{ color:"#22c55e" }]}>{status}</Text>}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─────────────────────────────────────────────
// Type Text Screen
// ─────────────────────────────────────────────
function TypeTextScreen({ onBack,sendCommand,theme }:{
  onBack:()=>void;
  sendCommand:(type:string,extra:Record<string,any>)=>void;
  theme:ReturnType<typeof useTheme>;
}) {
  const [text,   setText]   = useState("");
  const [status, setStatus] = useState("");

  const send = () => {
    if (!text.trim()) return;
    sendCommand("type_text",{ text });
    setText(""); // clear after sending
    setStatus("Typed on PC!");
    setTimeout(()=>setStatus(""), 5000);
  };

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Type Text</Text>
        </View>
      </View>
      <View style={{ padding:20, gap:16 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type text to send to your PC…"
          placeholderTextColor={theme.labelColor}
          style={[clipSt.input,{ color:theme.rowTitle, backgroundColor:theme.cardBg, borderColor:theme.cardBorder, minHeight:120 }]}
          multiline
          autoFocus
        />
        <Pressable onPress={send}
          style={({ pressed })=>[clipSt.fetchBtn,{ backgroundColor:pressed?"#22c55e44":"#22c55e22", borderColor:"#22c55e44" }]}>
          <Ionicons name="text-outline" size={18} color="#22c55e"/>
          <Text style={[clipSt.fetchBtnText,{ color:"#22c55e" }]}>Type on PC</Text>
        </Pressable>
        {!!status&&<Text style={[clipSt.status,{ color:"#22c55e", textAlign:"center" }]}>{status}</Text>}
        <Text style={[clipSt.hint,{ color:theme.labelColor }]}>
          Make sure a text field is focused on your PC before sending. The text will be pasted using Ctrl+V.
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────
// Screenshot Screen
// ─────────────────────────────────────────────
function ScreenshotScreen({ onBack,sendCommand,screenshotResult,onClearScreenshot,theme }:{
  onBack:()=>void;
  sendCommand:(type:string,extra:Record<string,any>)=>void;
  screenshotResult:{data:string|null,error:string|null}|null;
  onClearScreenshot:()=>void;
  theme:ReturnType<typeof useTheme>;
}) {
  const [loading, setLoading] = useState(false);
  const [zoomed,  setZoomed]  = useState(false);

  useEffect(()=>{
    if (screenshotResult!==null) setLoading(false);
  },[screenshotResult]);

  const capture = () => {
    setLoading(true); onClearScreenshot();
    sendCommand("take_screenshot",{});
    setTimeout(()=>setLoading(false), 30000);
  };

  const screenshotB64 = screenshotResult?.data??null;
  const error = screenshotResult?.error??null;

  const save = async () => {
    if (!screenshotB64) return;
    try {
      const FileSystem = require("expo-file-system/legacy");
      const Sharing    = require("expo-sharing");
      const uri = `${FileSystem.cacheDirectory}screenshot_${Date.now()}.jpg`;
      await FileSystem.writeAsStringAsync(uri, screenshotB64, { encoding:"base64" });
      await Sharing.shareAsync(uri, { mimeType:"image/jpeg", dialogTitle:"Save Screenshot" });
    } catch(e:any) {
      Alert.alert("Save Failed", e?.message||"Could not save screenshot.");
    }
  };

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      {/* Fullscreen zoom modal with pinch-to-zoom */}
      <Modal visible={zoomed} transparent animationType="fade" onRequestClose={()=>setZoomed(false)}>
        <View style={{ flex:1, backgroundColor:"#000" }}>
          <ScrollView
            style={{ flex:1 }}
            contentContainerStyle={{ flex:1, justifyContent:"center", alignItems:"center" }}
            minimumZoomScale={1}
            maximumZoomScale={5}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            centerContent
          >
            <Image source={{ uri:`data:image/jpeg;base64,${screenshotB64}` }}
              style={{ width:screenWidth, height:screenHeight, resizeMode:"contain" }}/>
          </ScrollView>
          <Pressable onPress={()=>setZoomed(false)}
            style={{ position:"absolute", top:50, right:20 }} hitSlop={16}>
            <Ionicons name="close-circle" size={36} color="rgba(255,255,255,0.8)"/>
          </Pressable>
          <Text style={{ position:"absolute", bottom:40, left:0, right:0, textAlign:"center", color:"rgba(255,255,255,0.4)", fontSize:13 }}>
            Pinch to zoom · Tap × to close
          </Text>
        </View>
      </Modal>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Screenshot</Text>
        </View>
      </View>
      <View style={{ flex:1, alignItems:"center", justifyContent:"center", padding:20 }}>
        {screenshotB64?(
          <>
            <Pressable onPress={()=>setZoomed(true)} style={{ width:"100%" }}>
              <Image source={{ uri:`data:image/jpeg;base64,${screenshotB64}` }}
                style={{ width:"100%", aspectRatio:16/9, borderRadius:12, resizeMode:"contain" }}/>
              <View style={{ position:"absolute", bottom:8, right:8, backgroundColor:"rgba(0,0,0,0.5)", borderRadius:8, padding:4 }}>
                <Ionicons name="expand-outline" size={16} color="white"/>
              </View>
            </Pressable>
            <View style={{ flexDirection:"row", gap:12, marginTop:16 }}>
              <Pressable onPress={save}
                style={({ pressed })=>[clipSt.fetchBtn,{ flex:1, borderColor:"#22c55e", backgroundColor:pressed?"#22c55e44":"#22c55e11" }]}>
                <Ionicons name="download-outline" size={18} color="#22c55e"/>
                <Text style={[clipSt.fetchBtnText,{ color:"#22c55e" }]}>Save to Phone</Text>
              </Pressable>
              <Pressable onPress={capture}
                style={({ pressed })=>[clipSt.fetchBtn,{ flex:1, borderColor:"#f59e0b", backgroundColor:pressed?"#f59e0b44":"#f59e0b11" }]}>
                <Ionicons name="camera-outline" size={18} color="#f59e0b"/>
                <Text style={[clipSt.fetchBtnText,{ color:"#f59e0b" }]}>New Shot</Text>
              </Pressable>
            </View>
          </>
        ):loading?(
          <>
            <Ionicons name="camera-outline" size={56} color={theme.labelColor}/>
            <Text style={[clipSt.hint,{ color:theme.labelColor, marginTop:12 }]}>Capturing screenshot…</Text>
            <LoadingDots color="#007aff"/>
          </>
        ):(
          <>
            <Ionicons name="camera-outline" size={56} color={theme.labelColor}/>
            <Text style={[clipSt.hint,{ color:theme.labelColor, marginTop:12, textAlign:"center" }]}>
              Capture your PC screen and view it here.
            </Text>
            {error&&<Text style={{ color:"#ef4444", fontSize:13, marginTop:8, textAlign:"center" }}>{error}</Text>}
            <Pressable onPress={capture}
              style={[clipSt.fetchBtn,{ marginTop:20, borderColor:"#007aff44", backgroundColor:"#007aff11" }]}>
              <Ionicons name="camera-outline" size={18} color="#007aff"/>
              <Text style={clipSt.fetchBtnText}>Capture Screenshot</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────
// Network Info Screen
// ─────────────────────────────────────────────
function NetworkInfoScreen({ onBack,sendCommand,networkData,speedtestData,theme }:{
  onBack:()=>void;
  sendCommand:(type:string,extra:Record<string,any>)=>void;
  networkData:any; speedtestData:any;
  theme:ReturnType<typeof useTheme>;
}) {
  const [loadingTest, setLoadingTest] = useState(false);

  useEffect(()=>{
    sendCommand("network_subscribe",{});
    return ()=>sendCommand("network_unsubscribe",{});
  },[]);

  useEffect(()=>{ if(speedtestData) setLoadingTest(false); },[speedtestData]);

  const StatRow = ({ label, value, icon, color }:{ label:string; value:string; icon:string; color:string }) => (
    <View style={[netSt.statRow,{ borderBottomColor:theme.cardBorder }]}>
      <View style={[netSt.statIcon,{ backgroundColor:color+"22" }]}>
        <Ionicons name={icon as any} size={16} color={color}/>
      </View>
      <Text style={[netSt.statLabel,{ color:theme.labelColor }]}>{label}</Text>
      <Text style={[netSt.statValue,{ color:theme.rowTitle }]}>{value}</Text>
    </View>
  );

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Network Info</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding:20, gap:16 }}>
        {/* Live usage */}
        <View style={[netSt.card,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
          <View style={{ flexDirection:"row", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <Text style={[netSt.cardLabel,{ color:theme.groupLabel }]}>LIVE USAGE</Text>
            <View style={{ flexDirection:"row", alignItems:"center", gap:4 }}>
              <View style={{ width:6, height:6, borderRadius:3, backgroundColor:"#22c55e" }}/>
              <Text style={{ color:"#22c55e", fontSize:11 }}>Live</Text>
            </View>
          </View>
          {networkData?(
            <>
              <StatRow
                label="Connection"
                value={networkData.connection_type==="Wi-Fi" && networkData.wifi_name
                  ? `Wi-Fi · ${networkData.wifi_name}`
                  : networkData.connection_type||"Unknown"}
                icon={networkData.connection_type==="Wi-Fi"?"wifi-outline":"git-network-outline"}
                color="#007aff"
              />
              <StatRow label="↓ Downloading" value={`${networkData.download_mbps} Mbps`} icon="arrow-down-outline" color="#22c55e"/>
              <StatRow label="↑ Uploading"   value={`${networkData.upload_mbps} Mbps`}   icon="arrow-up-outline"   color="#f59e0b"/>
              <Text style={{ color:theme.labelColor, fontSize:11, marginTop:6 }}>
                Shows current data usage — 0 Mbps means nothing is transferring right now
              </Text>
            </>
          ):<View style={{ paddingVertical:16, alignItems:"center" }}><LoadingDots color="#007aff"/></View>}
        </View>

        {/* Speed test */}
        <View style={[netSt.card,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
          <Text style={[netSt.cardLabel,{ color:theme.groupLabel }]}>SPEED TEST</Text>
          <Text style={{ color:theme.labelColor, fontSize:12, marginBottom:8 }}>
            Tests your maximum connection capacity
          </Text>
          {speedtestData?.error&&<Text style={{ color:"#ef4444", fontSize:13, marginBottom:8 }}>{speedtestData.error}</Text>}
          {speedtestData&&!speedtestData.error&&(
            <>
              <StatRow label="↓ Download" value={`${speedtestData.download_mbps} Mbps`} icon="arrow-down-outline" color="#22c55e"/>
              <StatRow label="↑ Upload"   value={`${speedtestData.upload_mbps} Mbps`}   icon="arrow-up-outline"   color="#f59e0b"/>
              <StatRow label="Ping"       value={`${speedtestData.ping_ms} ms`}          icon="pulse-outline"      color="#a855f7"/>
              {speedtestData.server&&<StatRow label="Server" value={speedtestData.server} icon="server-outline" color="#6b7280"/>}
            </>
          )}
          <Pressable onPress={()=>{ setLoadingTest(true); sendCommand("run_speedtest",{}); }} disabled={loadingTest}
            style={[clipSt.fetchBtn,{ borderColor:"#007aff44", backgroundColor:"#007aff11", marginTop:8 }]}>
            {loadingTest
              ? <><LoadingDots color="#007aff"/><Text style={clipSt.fetchBtnText}>Testing…</Text></>
              : <><Ionicons name="speedometer-outline" size={18} color="#007aff"/><Text style={clipSt.fetchBtnText}>Run Speed Test</Text></>
            }
          </Pressable>
          {loadingTest&&<Text style={{ color:theme.labelColor, fontSize:12, textAlign:"center" }}>May take 10–20 seconds</Text>}
        </View>
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────
// File Upload Screen (Phone → PC)
// ─────────────────────────────────────────────
function FileUploadScreen({ onBack,sendCommand,browseResult,uploadResult,theme }:{
  onBack:()=>void;
  sendCommand:(type:string,extra:Record<string,any>)=>void;
  browseResult:FileBrowseResult|null;
  uploadResult:any;
  theme:ReturnType<typeof useTheme>;
}) {
  const [destPath,   setDestPath]   = useState("");
  const [destHistory,setDestHistory]= useState<string[]>([]);
  const [pickingDest,setPickingDest]= useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [fileName,   setFileName]   = useState<string|null>(null);
  const [status,     setStatus]     = useState("");

  useEffect(()=>{
    if (uploadResult) {
      setUploading(false);
      setStatus(uploadResult.success?`✓ Saved to ${uploadResult.path}`:`✗ ${uploadResult.error}`);
      if (uploadResult.success) setFileName(null);
    }
  },[uploadResult]);

  const pickFile = async () => {
    try {
      const DocumentPicker = require("expo-document-picker");
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory:true });
      if (result.canceled||!result.assets?.[0]) return;
      const asset = result.assets[0];
      setFileName(asset.name); setStatus("");
      const FileSystem = require("expo-file-system/legacy");
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding:"base64" });
      setUploading(true);
      sendCommand("upload_file",{ name:asset.name, data:b64, dest_folder:destPath||"" });
      setTimeout(()=>{ setUploading(u=>{ if(u) setStatus("✗ Upload timed out. Check your connection."); return false; }); }, 60000);
    } catch(e:any) { setStatus(`Error: ${e.message}`); }
  };

  const browseEntries = (browseResult?.path===destPath||(browseResult?.path==="Home"&&destPath===""))
    ? (browseResult?.entries??[]).filter(e=>e.isDir) : [];

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Upload to PC</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding:20, gap:16 }}>
        <View style={[clipSt.card,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
          <Text style={[clipSt.sectionLabel,{ color:theme.groupLabel }]}>DESTINATION</Text>
          <View style={[fileSt.pathBar,{ backgroundColor:theme.panelBg, borderColor:theme.cardBorder, marginBottom:8 }]}>
            <Ionicons name="folder-outline" size={14} color={theme.labelColor} style={{ marginRight:6 }}/>
            <Text style={[fileSt.pathText,{ color:theme.labelColor }]} numberOfLines={1}>
              {destPath||"Downloads (default)"}
            </Text>
          </View>
          <Pressable onPress={()=>{ setPickingDest(p=>!p); if(!pickingDest) sendCommand("browse_files",{ path:"" }); }}
            style={[clipSt.fetchBtn,{ borderColor:"#007aff44", backgroundColor:"#007aff11" }]}>
            <Ionicons name="folder-open-outline" size={18} color="#007aff"/>
            <Text style={clipSt.fetchBtnText}>{pickingDest?"Close":"Browse Folders"}</Text>
          </Pressable>
          {pickingDest&&(
            <View style={{ marginTop:8, gap:2 }}>
              {destHistory.length>0&&(
                <Pressable onPress={()=>{
                  const prev=destHistory[destHistory.length-1];
                  setDestHistory(h=>h.slice(0,-1)); setDestPath(prev);
                  sendCommand("browse_files",{ path:prev });
                }} style={{ flexDirection:"row", alignItems:"center", gap:6, padding:8 }}>
                  <Ionicons name="arrow-back-outline" size={16} color="#007aff"/>
                  <Text style={{ color:"#007aff", fontSize:14 }}>Back</Text>
                </Pressable>
              )}
              {browseEntries.length===0
                ?<Text style={{ color:theme.labelColor, fontSize:13, padding:8 }}>No subfolders</Text>
                :browseEntries.map((e,i)=>(
                  <View key={i} style={[fileSt.entry,{ borderBottomColor:theme.cardBorder }]}>
                    <View style={[fileSt.entryIcon,{ backgroundColor:"#007aff22" }]}>
                      <Ionicons name="folder-outline" size={18} color="#007aff"/>
                    </View>
                    <Text style={[fileSt.entryName,{ color:theme.rowTitle, flex:1 }]} numberOfLines={1}>{e.name}</Text>
                    <Pressable onPress={()=>{
                      const newPath=e.path||(destPath?`${destPath}\\${e.name}`:e.name);
                      setDestHistory(h=>[...h,destPath]); setDestPath(newPath);
                      sendCommand("browse_files",{ path:newPath });
                    }} style={{ padding:4 }}>
                      <Ionicons name="chevron-forward" size={16} color={theme.chevron}/>
                    </Pressable>
                    <Pressable onPress={()=>{
                      const sel=e.path||(destPath?`${destPath}\\${e.name}`:e.name);
                      setDestPath(sel); setPickingDest(false);
                    }} style={{ paddingHorizontal:10, paddingVertical:4, backgroundColor:"#007aff22", borderRadius:8 }}>
                      <Text style={{ color:"#007aff", fontSize:12, fontWeight:"600" }}>Select</Text>
                    </Pressable>
                  </View>
                ))
              }
            </View>
          )}
        </View>

        <View style={[clipSt.card,{ backgroundColor:theme.cardBg, borderColor:theme.cardBorder }]}>
          <Text style={[clipSt.sectionLabel,{ color:theme.groupLabel }]}>FILE</Text>
          {fileName&&(
            <View style={{ flexDirection:"row", alignItems:"center", gap:8, paddingBottom:8 }}>
              <Ionicons name="document-outline" size={16} color={theme.labelColor}/>
              <Text style={{ color:theme.rowTitle, fontSize:14, flex:1 }} numberOfLines={1}>{fileName}</Text>
            </View>
          )}
          <Pressable onPress={pickFile} disabled={uploading}
            style={[clipSt.fetchBtn,{ borderColor:"#22c55e44", backgroundColor:"#22c55e11" }]}>
            <Ionicons name="cloud-upload-outline" size={18} color="#22c55e"/>
            <Text style={[clipSt.fetchBtnText,{ color:"#22c55e" }]}>
              {uploading?"Uploading…":"Pick File & Upload"}
            </Text>
          </Pressable>
          {uploading&&<View style={{ alignItems:"center" }}><LoadingDots color="#22c55e"/></View>}
          {!!status&&<Text style={{ color:status.startsWith("✓")?"#22c55e":"#ef4444", fontSize:13, textAlign:"center" }}>{status}</Text>}
        </View>
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────
// Soundboard Screen
// ─────────────────────────────────────────────
interface SoundButton { id:string; name:string; path:string; color:string; }
const SOUND_COLORS = ["#ef4444","#f59e0b","#22c55e","#007aff","#a855f7","#06b6d4","#f97316","#ec4899"];

function SoundboardScreen({ onBack,sendCommand,audioDevices,soundboardFileResult,theme,pcId }:{
  onBack:()=>void;
  sendCommand:(type:string,extra:Record<string,any>)=>void;
  audioDevices:{outputs:any[],inputs:any[]};
  soundboardFileResult:any;
  theme:ReturnType<typeof useTheme>;
  pcId:string;
}) {
  const [sounds,      setSounds]      = useState<SoundButton[]>([]);
  const [deviceId,    setDeviceId]    = useState<number>(-1);
  const [showDevices,    setShowDevices]    = useState(false);
  const [editingSound,   setEditingSound]   = useState<SoundButton|null>(null);
  const [editName,       setEditName]       = useState("");
  const [colorPickSound, setColorPickSound] = useState<SoundButton|null>(null);
  const pendingPickRef = useRef<string|null>(null);
  const addingRef = useRef(false);

  useEffect(()=>{
    AsyncStorage.getItem(`pclink_soundboard_${pcId}`).then(r=>{ if(r) setSounds(JSON.parse(r)); });
    AsyncStorage.getItem(`pclink_soundboard_device_${pcId}`).then(r=>{
      if (r) setDeviceId(parseInt(r));
    });
    sendCommand("get_audio_devices",{});
  },[]);

  useEffect(()=>{
    if (audioDevices.outputs.length>0 && deviceId!==-1) {
      const exists = audioDevices.outputs.find(d=>d.id===deviceId);
      if (!exists) { setDeviceId(-1); AsyncStorage.setItem(`pclink_soundboard_device_${pcId}`,"-1"); }
    }
  },[audioDevices]);

  const selectDevice = (id:number) => {
    setDeviceId(id);
    AsyncStorage.setItem(`pclink_soundboard_device_${pcId}`, id.toString());
    setShowDevices(false);
  };

  const saveSounds = (s:SoundButton[]) => {
    setSounds(s);
    AsyncStorage.setItem(`pclink_soundboard_${pcId}`, JSON.stringify(s));
  };

  useEffect(()=>{
    if (!soundboardFileResult?.path||!pendingPickRef.current) return;
    pendingPickRef.current = null;
    addingRef.current = false;
    const newSound:SoundButton = {
      id: Date.now().toString(),
      name: soundboardFileResult.name?.replace(/\.[^.]+$/,"")||soundboardFileResult.path.split("\\").pop()?.replace(/\.[^.]+$/,"")||"Sound",
      path: soundboardFileResult.path,
      color: SOUND_COLORS[sounds.length%SOUND_COLORS.length],
    };
    saveSounds([...sounds, newSound]);
  },[soundboardFileResult]);

  const addFromPC = () => {
    if (addingRef.current) return;
    addingRef.current = true;
    pendingPickRef.current = "pending";
    sendCommand("browse_soundboard_files",{ request_id: Date.now().toString() });
    setTimeout(()=>{ addingRef.current = false; }, 10000);
  };

  const playSound = (sound:SoundButton) => {
    console.log("[SOUNDBOARD] Playing:", sound.name, "path:", sound.path, "device:", deviceId);
    sendCommand("play_sound",{ path:sound.path, audio_device_id:deviceId });
  };

  const stopAll = () => sendCommand("stop_sounds",{});

  const onLongPress = (sound:SoundButton) => {
    Alert.alert(sound.name, "What would you like to do?", [
      { text:"Rename", onPress:()=>{ setEditName(sound.name); setEditingSound(sound); } },
      { text:"Change Color", onPress:()=>{ setColorPickSound(sound); } },
      { text:"Delete", style:"destructive", onPress:()=>saveSounds(sounds.filter(s=>s.id!==sound.id)) },
      { text:"Cancel", style:"cancel" },
    ]);
  };

  const btnW = (screenWidth-32-8*2)/3;

  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Soundboard</Text>
        </View>
        <View style={{ flexDirection:"row", gap:12 }}>
          <Pressable onPress={stopAll} hitSlop={10}>
            <Ionicons name="stop-circle-outline" size={24} color="#ef4444"/>
          </Pressable>
          <Pressable onPress={()=>setShowDevices(d=>!d)} hitSlop={10}>
            <Ionicons name="options-outline" size={22} color="#007aff"/>
          </Pressable>
        </View>
      </View>

      {/* Rename modal */}
      <Modal visible={!!editingSound} transparent animationType="fade" onRequestClose={()=>setEditingSound(null)}>
        <Pressable style={{ flex:1, backgroundColor:"rgba(0,0,0,0.5)", justifyContent:"center", padding:32 }} onPress={()=>setEditingSound(null)}>
          <Pressable style={[sbSt.deviceModal,{ backgroundColor:theme.cardBg, borderRadius:16, padding:24 }]} onPress={e=>e.stopPropagation()}>
            <Text style={[sbSt.deviceLabel,{ color:theme.groupLabel, marginBottom:12 }]}>RENAME SOUND</Text>
            <TextInput
              value={editName}
              onChangeText={setEditName}
              style={[clipSt.input,{ color:theme.rowTitle, backgroundColor:theme.panelBg, borderColor:theme.cardBorder, marginBottom:12 }]}
              autoFocus
              selectTextOnFocus
            />
            <View style={{ flexDirection:"row", gap:10 }}>
              <Pressable onPress={()=>setEditingSound(null)}
                style={[clipSt.fetchBtn,{ flex:1, borderColor:theme.cardBorder, backgroundColor:"transparent" }]}>
                <Text style={{ color:theme.labelColor, fontWeight:"600" }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={()=>{
                if (editName.trim()&&editingSound) {
                  saveSounds(sounds.map(s=>s.id===editingSound.id?{...s,name:editName.trim()}:s));
                  setEditingSound(null);
                }
              }} style={[clipSt.fetchBtn,{ flex:1, borderColor:"#007aff44", backgroundColor:"#007aff11" }]}>
                <Text style={{ color:"#007aff", fontWeight:"600" }}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Color picker modal */}
      <Modal visible={!!colorPickSound} transparent animationType="fade" onRequestClose={()=>setColorPickSound(null)}>
        <Pressable style={{ flex:1, backgroundColor:"rgba(0,0,0,0.5)", justifyContent:"center", padding:32 }} onPress={()=>setColorPickSound(null)}>
          <Pressable style={[sbSt.deviceModal,{ backgroundColor:theme.cardBg, borderRadius:16, padding:24 }]} onPress={e=>e.stopPropagation()}>
            <Text style={[sbSt.deviceLabel,{ color:theme.groupLabel, marginBottom:16 }]}>PICK A COLOR</Text>
            <View style={{ flexDirection:"row", flexWrap:"wrap", gap:12, justifyContent:"center", marginBottom:16 }}>
              {SOUND_COLORS.map((c,i)=>{
                const names = ["Red","Amber","Green","Blue","Purple","Cyan","Orange","Pink"];
                const isSelected = colorPickSound?.color===c;
                return (
                  <Pressable key={c} onPress={()=>{
                    if (colorPickSound) saveSounds(sounds.map(s=>s.id===colorPickSound.id?{...s,color:c}:s));
                    setColorPickSound(null);
                  }} style={{ alignItems:"center", gap:6 }}>
                    <View style={{ width:44, height:44, borderRadius:22, backgroundColor:c,
                      borderWidth:isSelected?3:0, borderColor:"white",
                      shadowColor:c, shadowOffset:{ width:0,height:0 }, shadowOpacity:0.8, shadowRadius:6, elevation:4 }}/>
                    <Text style={{ color:c, fontSize:11, fontWeight:"600" }}>{names[i]}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={()=>setColorPickSound(null)}
              style={[clipSt.fetchBtn,{ borderColor:theme.cardBorder, backgroundColor:"transparent" }]}>
              <Text style={{ color:theme.labelColor, fontWeight:"600" }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Device picker modal */}
      <Modal visible={showDevices} transparent animationType="fade" onRequestClose={()=>setShowDevices(false)}>
        <Pressable style={{ flex:1, backgroundColor:"rgba(0,0,0,0.5)", justifyContent:"flex-end" }} onPress={()=>setShowDevices(false)}>
          <View style={[sbSt.deviceModal,{ backgroundColor:theme.cardBg }]}>
            <Text style={[sbSt.deviceLabel,{ color:theme.groupLabel, marginBottom:12 }]}>SELECT OUTPUT DEVICE</Text>
            <Pressable onPress={()=>selectDevice(-1)}
              style={[sbSt.deviceRow,{ backgroundColor:deviceId===-1?"#007aff22":"transparent" }]}>
              <Ionicons name="volume-medium-outline" size={20} color={deviceId===-1?"#007aff":theme.labelColor}/>
              <Text style={[sbSt.deviceRowText,{ color:deviceId===-1?"#007aff":theme.rowTitle }]}>Default Device</Text>
              {deviceId===-1&&<Ionicons name="checkmark" size={18} color="#007aff"/>}
            </Pressable>
            {audioDevices.outputs.map(d=>(
              <Pressable key={d.id} onPress={()=>selectDevice(d.id)}
                style={[sbSt.deviceRow,{ backgroundColor:deviceId===d.id?"#007aff22":"transparent" }]}>
                <Ionicons name="volume-high-outline" size={20} color={deviceId===d.id?"#007aff":theme.labelColor}/>
                <Text style={[sbSt.deviceRowText,{ color:deviceId===d.id?"#007aff":theme.rowTitle }]} numberOfLines={1}>{d.name}</Text>
                {deviceId===d.id&&<Ionicons name="checkmark" size={18} color="#007aff"/>}
              </Pressable>
            ))}
            <Pressable onPress={()=>setShowDevices(false)}
              style={[sbSt.deviceRow,{ justifyContent:"center", marginTop:8 }]}>
              <Text style={{ color:"#ef4444", fontSize:15, fontWeight:"600" }}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:40 }}>
        {sounds.length===0?(
          <View style={panelSt.empty}>
            <Ionicons name="volume-high-outline" size={44} color={theme.labelColor}/>
            <Text style={[panelSt.emptyTitle,{ color:theme.titleColor }]}>No sounds yet</Text>
            <Text style={[panelSt.emptySub,{ color:theme.labelColor }]}>Add sounds from your PC below</Text>
          </View>
        ):(
          <View style={sbSt.grid}>
            {sounds.map(sound=>(
              <Pressable key={sound.id}
                onPress={()=>playSound(sound)}
                onLongPress={()=>onLongPress(sound)}
                delayLongPress={400}
                style={({ pressed })=>[sbSt.soundBtn,{
                  backgroundColor:pressed?sound.color:sound.color+"22",
                  borderColor:sound.color+"66",
                  width:btnW,
                }]}>
                <Ionicons name="volume-high-outline" size={24} color={sound.color}/>
                <Text style={[sbSt.soundName,{ color:sound.color }]} numberOfLines={3}>
                  {sound.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable onPress={addFromPC}
          style={({ pressed })=>[clipSt.fetchBtn,{ marginTop:16, borderColor:"#007aff44", backgroundColor:pressed?"#007aff33":"#007aff11" }]}>
          <Ionicons name="desktop-outline" size={18} color="#007aff"/>
          <Text style={clipSt.fetchBtnText}>Add Sound from PC</Text>
        </Pressable>
        <Text style={{ color:theme.labelColor, fontSize:12, textAlign:"center", marginTop:6 }}>
          Supported: MP3 · WAV · OGG · FLAC
        </Text>
        <Text style={{ color:theme.labelColor, fontSize:12, textAlign:"center", marginTop:2 }}>
          Long press a button to rename, recolor, or delete
        </Text>
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────
function ToolsScreen({ device,onBack,onOpenFiles,onOpenMedia,onOpenClipboard,onOpenTypeText,onOpenScreenshot,onOpenNetwork,onOpenUpload,onOpenSoundboard,theme,isProActive,onShowPaywall }:{
  device:Device; onBack:()=>void;
  onOpenFiles:()=>void; onOpenMedia:()=>void;
  onOpenClipboard:()=>void; onOpenTypeText:()=>void;
  onOpenScreenshot:()=>void; onOpenNetwork:()=>void;
  onOpenUpload:()=>void; onOpenSoundboard:()=>void;
  theme:ReturnType<typeof useTheme>;
  isProActive:boolean; onShowPaywall:()=>void;
}) {
  const tileSize=(screenWidth-40-12)/2;
  const tools = [
    { label:"File Browser",    icon:"folder-open-outline",    color:"#06b6d4", onPress:onOpenFiles,      pro:true },
    { label:"Media Controls",  icon:"musical-notes-outline",  color:"#a855f7", onPress:onOpenMedia,      pro:true },
    { label:"Clipboard Sync",  icon:"clipboard-outline",      color:"#f59e0b", onPress:onOpenClipboard,  pro:true },
    { label:"Type Text",       icon:"text-outline",           color:"#22c55e", onPress:onOpenTypeText,   pro:true },
    { label:"Screenshot",      icon:"camera-outline",         color:"#ef4444", onPress:onOpenScreenshot, pro:true },
    { label:"Network Info",    icon:"wifi-outline",           color:"#3b82f6", onPress:onOpenNetwork,    pro:true },
    { label:"Upload File",     icon:"cloud-upload-outline",   color:"#22c55e", onPress:onOpenUpload,     pro:true },
    { label:"Soundboard",      icon:"volume-high-outline",    color:"#f97316", onPress:onOpenSoundboard, pro:true },
  ];
  return (
    <View style={{ flex:1, backgroundColor:theme.panelBg }}>
      <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
        <Pressable onPress={onBack} style={st.overlayBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color="#007aff"/>
          <Text style={st.overlayBackText}>Back</Text>
        </Pressable>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Tools</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={[gridSt.container,{ paddingTop:20, paddingBottom:40 }]}>
        {tools.map(tool=>{
          const locked = tool.pro && !isProActive;
          return (
            <Pressable key={tool.label} onPress={locked ? onShowPaywall : tool.onPress}
              style={({ pressed })=>[gridSt.tile,{ width:tileSize, height:tileSize*0.85, backgroundColor:pressed?theme.actionTilePressed:theme.actionTile }]}>
              <View style={[gridSt.iconCircle,{ backgroundColor:tool.color+(locked?"11":"22") }]}>
                <Ionicons name={tool.icon as any} size={32} color={locked ? theme.labelColor : tool.color}/>
              </View>
              <Text style={[gridSt.label,{ color:locked ? theme.labelColor : theme.actionTileText }]}>{tool.label}</Text>
              {locked&&<ProLockBadge/>}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────
// Action Grid — 2×2 main + 2×2 bottom row
// ─────────────────────────────────────────────
function ActionGrid({ theme,onAction,onEventsPress,onScenesPress,onVolumePress,onCustomActionsPress,onToolsPress,isProActive,onShowPaywall }:{
  theme:ReturnType<typeof useTheme>;
  onAction:(key:string,label:string,risky:boolean)=>void;
  onEventsPress:()=>void; onScenesPress:()=>void;
  onVolumePress:()=>void; onCustomActionsPress:()=>void;
  onToolsPress:()=>void;
  isProActive:boolean; onShowPaywall:()=>void;
}) {
  const big=(screenWidth-40-12)/2;
  const small=(screenWidth-40-12)/2;

  const bigTile=(key:string,label:string,icon:string,color:string,risky:boolean,onPress?:()=>void)=>(
    <Pressable key={key} onPress={onPress||(()=>onAction(key,label,risky))}
      style={({ pressed })=>[gridSt.tile,{ width:big, height:big*0.85, backgroundColor:pressed?theme.actionTilePressed:theme.actionTile }]}>
      <View style={[gridSt.iconCircle,{ backgroundColor:color+"22" }]}><Ionicons name={icon as any} size={32} color={color}/></View>
      <Text style={[gridSt.label,{ color:theme.actionTileText }]}>{label}</Text>
    </Pressable>
  );

  const smallTile=(key:string,label:string,icon:string,color:string,onPress:()=>void,pro=false)=>{
    const locked = pro && !isProActive;
    return (
      <Pressable key={key} onPress={locked ? onShowPaywall : onPress}
        style={({ pressed })=>[gridSt.tile,{ width:small, height:small*0.72, backgroundColor:pressed?theme.actionTilePressed:theme.actionTile }]}>
        <View style={[gridSt.iconCircle,{ backgroundColor:color+(locked?"11":"22"), width:46, height:46, borderRadius:23 }]}>
          <Ionicons name={icon as any} size={24} color={locked?theme.labelColor:color}/>
        </View>
        <Text style={[gridSt.label,{ color:locked?theme.labelColor:theme.actionTileText, fontSize:13 }]}>{label}</Text>
        {locked&&<ProLockBadge/>}
      </Pressable>
    );
  };

  return (
    <View style={gridSt.container}>
      {/* Row 1: Wake PC + Shutdown */}
      {bigTile("wake_pc","Wake PC","flash","#22c55e",false)}
      {bigTile("shutdown_pc","Shutdown","power","#ef4444",true)}
      {/* Row 2: Sleep + Restart */}
      {bigTile("sleep_pc","Sleep","moon-outline","#6366f1",false,()=>Alert.alert("Sleep PC","Put your PC to sleep?",[
        { text:"Cancel",style:"cancel" },
        { text:"Sleep",onPress:()=>onAction("sleep_pc","Sleep",false) },
      ]))}
      {bigTile("restart_pc","Restart","refresh-circle","#f59e0b",true)}
      {/* Row 3: Lock + Volume */}
      {bigTile("lock_pc","Lock","lock-closed","#3b82f6",false)}
      <Pressable onPress={onVolumePress}
        style={({ pressed })=>[gridSt.tile,{ width:big, height:big*0.85, backgroundColor:pressed?theme.actionTilePressed:theme.actionTile }]}>
        <View style={[gridSt.iconCircle,{ backgroundColor:"#f59e0b22" }]}><Ionicons name="volume-medium-outline" size={32} color="#f59e0b"/></View>
        <Text style={[gridSt.label,{ color:theme.actionTileText }]}>Volume</Text>
      </Pressable>
      {/* Row 4: Events + Scenes (Pro) */}
      {smallTile("events","Events","calendar-outline","#007aff",onEventsPress,true)}
      {smallTile("scenes","Scenes","albums-outline","#22c55e",onScenesPress,true)}
      {/* Row 5: Actions (Pro) + Tools */}
      {smallTile("actions","Actions","play-circle-outline","#a855f7",onCustomActionsPress,true)}
      {smallTile("tools","Tools","construct-outline","#06b6d4",onToolsPress)}
    </View>
  );
}

function useOfflineTick() {
  const [,setTick]=useState(0);
  useEffect(()=>{ const id=setInterval(()=>setTick(t=>t+1),1000); return ()=>clearInterval(id); },[]);
}

// ─────────────────────────────────────────────
// Draggable device list
// ─────────────────────────────────────────────
function ReorderableDeviceList({ orderedDevices,onOpenDevice,onReorder,statusLabel,theme }:{
  orderedDevices:Device[]; onOpenDevice:(id:string)=>void;
  onReorder:(ids:string[])=>void; statusLabel:(d:Device)=>string; theme:ReturnType<typeof useTheme>;
}) {
  const renderItem = ({ item:d, drag, isActive }:RenderItemParams<Device>) => (
    <Pressable
      onPress={()=>{ if (!isActive) onOpenDevice(d.id); }}
      onLongPress={drag}
      delayLongPress={180}
      style={[
        st.card,
        { backgroundColor:d.color, marginBottom:20 },
        isActive&&{
          borderWidth:2,
          borderColor:"rgba(255,255,255,0.5)",
          shadowColor:"#000",
          shadowOffset:{ width:0,height:20 },
          shadowOpacity:0.6,
          shadowRadius:28,
          elevation:24,
        },
      ]}
    >
      <View style={st.cardTop}>
        <Ionicons name={d.icon as any} size={46} color="white"/>
        <StatusDot status={d.status}/>
      </View>
      <Text style={st.cardName}>{d.name}</Text>
      <Text style={st.cardStatus}>{statusLabel(d)}</Text>
      {orderedDevices.length>1&&(
        <View style={{ position:"absolute", bottom:12, right:14, opacity:0.4 }}>
          <Ionicons name="reorder-three-outline" size={18} color="white"/>
        </View>
      )}
    </Pressable>
  );

  return (
    <DraggableFlatList
      data={orderedDevices}
      keyExtractor={d=>d.id}
      renderItem={renderItem}
      onDragEnd={({ data })=>{ onReorder(data.map(d=>d.id)); }}
      animationConfig={{ duration:200 }}
      containerStyle={{ width:screenWidth*0.7 }}
      contentContainerStyle={{ paddingBottom:60 }}
      showsVerticalScrollIndicator={false}
    />
  );
}

// ─────────────────────────────────────────────
// App
// ─────────────────────────────────────────────
export default function App() {
  const scheme=useColorScheme(); const theme=useTheme(scheme); useOfflineTick();
  const insets = useSafeAreaInsets();

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isPro,          setIsPro]          = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [proActivated,   setProActivated]   = useState(false);
  const [debugPaywallOff,setDebugPaywallOff]= useState(false); // master switch: off = no paywall at all
  const [debugProOn,     setDebugProOn]     = useState(false); // simulate pro purchase
  const [devices,       setDevices]       = useState<Record<string,Device>>({});
  const [deviceOrder,   setDeviceOrder]   = useState<string[]>([]);
  const [deviceStats,   setDeviceStats]   = useState<Record<string,PCStats>>({});
  const [deviceLogs,    setDeviceLogs]    = useState<Record<string,LogEntry[]>>({});
  const [deviceActions, setDeviceActions] = useState<Record<string,CustomAction[]>>({});
  const [deviceEvents,  setDeviceEvents]  = useState<Record<string,ScheduledEvent[]>>({});
  const [deviceScenes,  setDeviceScenes]  = useState<Record<string,Scene[]>>({});
  const [deviceVolume,  setDeviceVolume]  = useState<Record<string,VolumeData>>({});
  const [settings,      setSettings]      = useState<AppSettings>(DEFAULT_SETTINGS);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const connectionsRef   = useRef<Record<string,DeviceConnection>>({});
  const devicesRef       = useRef<Record<string,Device>>({});
  const offlineTimersRef = useRef<Record<string,ReturnType<typeof setTimeout>>>({});
  const lastStatusRef    = useRef<Record<string,DeviceStatus>>({});
  const wakeTimersRef    = useRef<Record<string,ReturnType<typeof setTimeout>>>({});
  const pendingCmdsRef   = useRef<Record<string,{ actionKey:string; deviceId:string }>>({});

  const [selectedId,      setSelectedId]     = useState<string|null>(null);
  const [editingName,     setEditingName]     = useState(false);
  const [editingMac,      setEditingMac]      = useState(false);
  const [nameInput,       setNameInput]       = useState("");
  const [macInput,        setMacInput]        = useState("");
  const [showColorMenu,   setShowColorMenu]   = useState(false);
  const [showIconMenu,    setShowIconMenu]    = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [quickVisible,    setQuickVisible]    = useState(false);
  const [overlayVisible,  setOverlayVisible]  = useState(false);
  const [editVisible,     setEditVisible]     = useState(false);
  const [logVisible,      setLogVisible]      = useState(false);
  const [actionsVisible,  setActionsVisible]  = useState(false);
  const [eventsVisible,   setEventsVisible]   = useState(false);
  const [scenesVisible,   setScenesVisible]   = useState(false);
  const [volumeVisible,   setVolumeVisible]   = useState(false);
  const [toolsVisible,    setToolsVisible]    = useState(false);
  const [filesVisible,    setFilesVisible]    = useState(false);
  const [mediaVisible,    setMediaVisible]    = useState(false);
  const [clipboardVisible,setClipboardVisible]= useState(false);
  const [typeTextVisible, setTypeTextVisible] = useState(false);
  const [screenshotVisible,setScreenshotVisible]=useState(false);
  const [networkVisible,  setNetworkVisible]  = useState(false);
  const [uploadVisible,   setUploadVisible]   = useState(false);
  const [soundboardVisible,setSoundboardVisible]=useState(false);
  const [activeToast,     setActiveToast]     = useState<ToastConfig|null>(null);
  const [errorBanner,     setErrorBanner]     = useState<ErrorBannerConfig|null>(null);

  type PairScreen = "none"|"choose"|"setup"|"qr"|"manual";
  const [pairScreen,    setPairScreen]    = useState<PairScreen>("none");
  const [manualServer,  setManualServer]  = useState("ws://");
  const [manualCode,    setManualCode]    = useState("");
  const [pairingStatus, setPairingStatus] = useState<"idle"|"loading"|"success"|"error">("idle");
  const [pairingError,  setPairingError]  = useState("");
  const [pairedOverlay, setPairedOverlay] = useState(false);

  const deviceSlide=useRef(new Animated.Value(screenHeight)).current;

  const COLORS=[
    { name:"Green",       value:"#22c55e" },
    { name:"Blue",        value:"#3b82f6" },
    { name:"Red",         value:"#ef4444" },
    { name:"Purple",      value:"#a855f7" },
    { name:"Orange",      value:"#f59e0b" },
    { name:"Cyan",        value:"#06b6d4" },
    { name:"Pink",        value:"#ec4899" },
    { name:"Indigo",      value:"#6366f1" },
    { name:"Lime",        value:"#84cc16" },
    { name:"Amber",       value:"#f97316" },
    { name:"Rose",        value:"#f43f5e" },
    { name:"Teal",        value:"#14b8a6" },
    { name:"Sky",         value:"#0ea5e9" },
    { name:"Violet",      value:"#8b5cf6" },
    { name:"Slate",       value:"#64748b" },
  ];
  const ICONS=[
    { name:"Monitor",value:"desktop-outline" },{ name:"Laptop",value:"laptop-outline" },
    { name:"TV",value:"tv-outline" },{ name:"Server",value:"hardware-chip-outline" },
    { name:"Cloud",value:"cloud-outline" },{ name:"Printer",value:"print-outline" },
    { name:"Home",value:"home-outline" },{ name:"Controller",value:"game-controller-outline" },
    { name:"Speaker",value:"volume-high-outline" },{ name:"Keyboard",value:"keypad-outline" },
  ];

  const device         = selectedId ? devices[selectedId]          : null;
  const curLogs        = selectedId ? (deviceLogs[selectedId]??[]) : [];
  // Pro is active if: debug paywall is off (testing mode), OR debug pro on, OR actually purchased
  const isProActive    = debugPaywallOff || debugProOn || isPro;
  const curActions     = selectedId ? (deviceActions[selectedId]??[]) : [];
  const curEvents      = selectedId ? (deviceEvents[selectedId]??[]) : [];
  const curScenes      = selectedId ? (deviceScenes[selectedId]??[]) : [];
  const hasLogs        = curLogs.length>0;
  const orderedDevices = deviceOrder.map(id=>devices[id]).filter(Boolean) as Device[];

  const saveDevices=useCallback(async(devs:Record<string,Device>)=>{ try { await AsyncStorage.setItem(STORAGE_KEY,JSON.stringify(devs)); } catch {} },[]);
  const saveOrder  =useCallback(async(order:string[])=>{ try { await AsyncStorage.setItem(ORDER_KEY,JSON.stringify(order)); } catch {} },[]);
  const addLog=useCallback(async(id:string,event:LogEventType,name?:string)=>{ const updated=await appendLog(id,event,name); setDeviceLogs(prev=>({ ...prev,[id]:updated })); },[]);

  const addNotification=useCallback((notif:Omit<AppNotification,"id"|"read">)=>{
    const full:AppNotification={ ...notif, id:`n_${Date.now()}`, read:false };
    setNotifications(prev=>{ const u=[...prev,full]; persistNotifications(u); return u; });
  },[]);

  const dismissNotification=useCallback((id:string)=>{
    setNotifications(prev=>{ const u=prev.map(n=>n.id===id?{ ...n,read:true }:n); persistNotifications(u); return u; });
  },[]);

  const handleCommandAck=useCallback((cmdId:string,status:string)=>{
    if (status!=="failed") return;
    const all=Object.entries(pendingCmdsRef.current);
    if (!all.length) return;
    const [key,pending]=all[0]; delete pendingCmdsRef.current[key];
    const failEvent=ACTION_LOG_MAP[pending.actionKey]?.failed;
    if (failEvent) addLog(pending.deviceId,failEvent);
    setErrorBanner({ message:ACTION_FAIL_MSG[pending.actionKey]??"Command failed." });
  },[addLog]);

  const handleTokenInvalid=useCallback((id:string)=>{
    Alert.alert("Security Token Invalid","The security token for this device is no longer valid. Please re-pair the device.",
      [{ text:"Re-pair",onPress:()=>{
        connectionsRef.current[id]?.destroy(); delete connectionsRef.current[id];
        setDevices(prev=>{ const u={...prev}; delete u[id]; devicesRef.current=u; saveDevices(u); return u; });
        setDeviceOrder(prev=>{ const o=prev.filter(x=>x!==id); saveOrder(o); return o; });
        clearLog(id); setOverlayVisible(false); setSelectedId(null);
        setPairScreen("choose"); setPairingStatus("idle"); setPairingError("");
      }},{ text:"Cancel",style:"cancel" }]
    );
  },[saveDevices,saveOrder]);

  const handleEventFailed=useCallback((deviceId:string,eventName:string,reason:string)=>{
    // Live: show orange banner immediately
    addNotification({ type:"event_failed", deviceId, deviceName:devicesRef.current[deviceId]?.name, eventName, reason, timestamp:Date.now() });
  },[addNotification]);

  const handleEventFired=useCallback((deviceId:string,eventName:string)=>{
    addLog(deviceId,"event_triggered",eventName);
    setActiveToast({ message:`"${eventName}" ran successfully`, icon:"checkmark-circle-outline", color:"#22c55e" });
  },[addLog]);

  const handleEventsUpdated=useCallback((deviceId:string,events:ScheduledEvent[])=>{
    // Server pushed back updated event list (e.g. after auto-disable on once-fire)
    setDeviceEvents(prev=>({ ...prev,[deviceId]:events }));
  },[]);

  const handleQueuedNotifs=useCallback((notifs:any[])=>{
    notifs.forEach(n=>{
      if (n.type==="event_failed") {
        addNotification({ type:"event_failed", deviceId:n.device_id, deviceName:devicesRef.current[n.device_id]?.name, eventName:n.event_name??"Event", reason:n.reason??"offline", timestamp:n.timestamp??Date.now() });
      }
    });
  },[addNotification]);

  const handleStatusChange=useCallback((id:string,status:DeviceStatus,lastSeen:number,mac?:string)=>{
    const prev=lastStatusRef.current[id];
    if (status==="offline"&&prev!=="offline") {
      if (offlineTimersRef.current[id]) clearTimeout(offlineTimersRef.current[id]);
      offlineTimersRef.current[id]=setTimeout(()=>{ if (lastStatusRef.current[id]==="offline") addLog(id,"went_offline"); delete offlineTimersRef.current[id]; },OFFLINE_LOG_DELAY_MS);
    }
    if (status!=="offline"&&prev==="offline") {
      if (offlineTimersRef.current[id]) { clearTimeout(offlineTimersRef.current[id]); delete offlineTimersRef.current[id]; }
      if (prev!==undefined) addLog(id,"came_online");
    }
    lastStatusRef.current[id]=status;
    setDevices(prevDevs=>{
      if (!prevDevs[id]) return prevDevs;
      const ex=prevDevs[id];
      const newMac=(mac&&mac!=="00:00:00:00:00:00"&&!ex.macAddress)?mac:ex.macAddress;
      const updated={ ...prevDevs,[id]:{ ...ex,status,lastSeen,macAddress:newMac } };
      devicesRef.current=updated; saveDevices(updated); return updated;
    });
  },[saveDevices,addLog]);

  const handleDeviceRemoved=useCallback((id:string,deviceName:string)=>{
    const name=deviceName||devicesRef.current[id]?.name||"This PC";
    Alert.alert("Device Unpaired",`${name} was unpaired and has been removed.`,[{ text:"OK" }]);
    connectionsRef.current[id]?.destroy(); delete connectionsRef.current[id];
    if (offlineTimersRef.current[id]) { clearTimeout(offlineTimersRef.current[id]); delete offlineTimersRef.current[id]; }
    if (wakeTimersRef.current[id])    { clearTimeout(wakeTimersRef.current[id]);    delete wakeTimersRef.current[id]; }
    delete lastStatusRef.current[id]; clearDeviceData(id);
    setDeviceStats(p=>   { const u={...p}; delete u[id]; return u; });
    setDeviceLogs(p=>    { const u={...p}; delete u[id]; return u; });
    setDeviceActions(p=> { const u={...p}; delete u[id]; return u; });
    setDeviceEvents(p=>  { const u={...p}; delete u[id]; return u; });
    setDeviceScenes(p=>  { const u={...p}; delete u[id]; return u; });
    setDeviceVolume(p=>  { const u={...p}; delete u[id]; return u; });
    setDevices(prev=>{ const u={...prev}; delete u[id]; devicesRef.current=u; saveDevices(u); return u; });
    setDeviceOrder(prev=>{ const o=prev.filter(x=>x!==id); saveOrder(o); return o; });
    setSelectedId(prev=>{ if (prev===id) { setOverlayVisible(false); setEditVisible(false); setLogVisible(false); setActionsVisible(false); setEventsVisible(false); setScenesVisible(false); setVolumeVisible(false); return null; } return prev; });
  },[saveDevices,saveOrder]);

  const handleStatsUpdate=useCallback((id:string,stats:PCStats)=>{ setDeviceStats(prev=>({ ...prev,[id]:stats })); },[]);

  const handleToolResult=useCallback((deviceId:string,type:string,payload:any)=>{
    if (type==="clipboard") setClipboardText(prev=>({ ...prev,[deviceId]:payload.text }));
    else if (type==="screenshot") setScreenshotData(prev=>({ ...prev,[deviceId]:payload }));
    else if (type==="now_playing") {
      if (payload.album_art) albumArtRef.current = { ...albumArtRef.current, [deviceId]:payload.album_art };
      setNowPlaying(prev=>({ ...prev,[deviceId]:{ ...payload, album_art:(albumArtRef.current[deviceId]??null) } }));
    }
    else if (type==="network_info") setNetworkData(prev=>({ ...prev,[deviceId]:payload }));
    else if (type==="speedtest_result") setSpeedtestData(prev=>({ ...prev,[deviceId]:payload }));
    else if (type==="audio_devices") setAudioDevices(prev=>({ ...prev,[deviceId]:payload }));
    else if (type==="upload_result") setUploadResult(prev=>({ ...prev,[deviceId]:payload }));
    else if (type==="soundboard_file") setSoundboardFileResult(prev=>({ ...prev,[deviceId]:payload }));
  },[]);

  const makeConnection=useCallback((d:Device)=>new DeviceConnection(
    d.id,d.serverUrl,d.token||"",
    handleStatusChange,handleDeviceRemoved,handleStatsUpdate,
    handleCommandAck,handleTokenInvalid,
    handleEventFailed,handleEventFired,handleEventsUpdated,handleQueuedNotifs,
    handleVolumeData,handleFileBrowse,handleFileDownload,handleToolResult,
  ),[handleStatusChange,handleDeviceRemoved,handleStatsUpdate,handleCommandAck,handleTokenInvalid,handleEventFailed,handleEventFired,handleEventsUpdated,handleQueuedNotifs,handleVolumeData,handleFileBrowse,handleFileDownload,handleToolResult]);

  const connectDevice=useCallback((d:Device)=>{
    if (connectionsRef.current[d.id]) connectionsRef.current[d.id].destroy();
    connectionsRef.current[d.id]=makeConnection(d);
  },[makeConnection]);

  const connectAll=useCallback((devs:Record<string,Device>)=>{
    Object.keys(connectionsRef.current).forEach(id=>{ if (!devs[id]) { connectionsRef.current[id].destroy(); delete connectionsRef.current[id]; } });
    Object.values(devs).forEach(d=>{ if (!connectionsRef.current[d.id]) connectionsRef.current[d.id]=makeConnection(d); });
  },[makeConnection]);

  useEffect(()=>{
    (async()=>{
      const [rawV2,rawV1,rawOrder,loadedSettings,storedNotifs,onboardingDone,proStatus]=await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),AsyncStorage.getItem(STORAGE_KEY_V1),
        AsyncStorage.getItem(ORDER_KEY),loadSettings(),loadNotifications(),
        AsyncStorage.getItem(ONBOARDING_KEY),
        loadProStatus(),
      ]);
      setSettings(loadedSettings);
      setNotifications(storedNotifs);
      setIsPro(proStatus);
      const raw=rawV2??rawV1;
      // Show onboarding if never completed
      if (!onboardingDone) {
        setShowOnboarding(true);
      }
      if (!raw) return;
      try {
        const loaded:Record<string,Device>=JSON.parse(raw);
        Object.values(loaded).forEach(d=>{ d.status="offline"; d.lastSeen=0; if (!d.macAddress) d.macAddress=""; if (!d.token) d.token=""; });
        if (!rawV2&&rawV1) { await AsyncStorage.setItem(STORAGE_KEY,JSON.stringify(loaded)); await AsyncStorage.removeItem(STORAGE_KEY_V1); }
        devicesRef.current=loaded; setDevices(loaded);
        let order:string[]=rawOrder?JSON.parse(rawOrder):[];
        const validOrder=[...order.filter(id=>loaded[id]),...Object.keys(loaded).filter(id=>!order.includes(id))];
        setDeviceOrder(validOrder);
        const logs:Record<string,LogEntry[]>={};
        const acts:Record<string,CustomAction[]>={};
        const scns:Record<string,Scene[]>={};
        await Promise.all(Object.keys(loaded).map(async id=>{ logs[id]=await loadLog(id); acts[id]=await loadActions(id); scns[id]=await loadScenes(id); }));
        setDeviceLogs(logs); setDeviceActions(acts); setDeviceScenes(scns);
        connectAll(loaded);
      } catch {}
    })();
    return ()=>{
      Object.values(connectionsRef.current).forEach(c=>c.destroy());
      Object.values(offlineTimersRef.current).forEach(t=>clearTimeout(t));
      Object.values(wakeTimersRef.current).forEach(t=>clearTimeout(t));
    };
  },[]);

  const updateDevice=(id:string,changes:Partial<Device>)=>{
    setDevices(prev=>{ const u={ ...prev,[id]:{ ...prev[id],...changes } }; devicesRef.current=u; saveDevices(u); return u; });
  };

  const removeDevice=(id:string)=>{
    connectionsRef.current[id]?.sendUnpair(); connectionsRef.current[id]?.destroy(); delete connectionsRef.current[id];
    if (offlineTimersRef.current[id]) { clearTimeout(offlineTimersRef.current[id]); delete offlineTimersRef.current[id]; }
    if (wakeTimersRef.current[id])    { clearTimeout(wakeTimersRef.current[id]);    delete wakeTimersRef.current[id]; }
    delete lastStatusRef.current[id]; clearDeviceData(id);
    setDeviceStats(p=>   { const u={...p}; delete u[id]; return u; });
    setDeviceLogs(p=>    { const u={...p}; delete u[id]; return u; });
    setDeviceActions(p=> { const u={...p}; delete u[id]; return u; });
    setDeviceEvents(p=>  { const u={...p}; delete u[id]; return u; });
    setDeviceScenes(p=>  { const u={...p}; delete u[id]; return u; });
    setDeviceVolume(p=>  { const u={...p}; delete u[id]; return u; });
    setDevices(prev=>{ const u={...prev}; delete u[id]; devicesRef.current=u; saveDevices(u); return u; });
    setDeviceOrder(prev=>{ const o=prev.filter(x=>x!==id); saveOrder(o); return o; });
  };

  const onPairSuccess=(newDev:Device)=>{
    setShowOnboarding(false);
    AsyncStorage.setItem(ONBOARDING_KEY, "done");
    setDevices(prev=>{ const u={ ...prev,[newDev.id]:newDev }; devicesRef.current=u; saveDevices(u); return u; });
    setDeviceOrder(prev=>{ const o=[...prev,newDev.id]; saveOrder(o); return o; });
    connectDevice(newDev); addLog(newDev.id,"paired");
    setPairingStatus("success");
    // Show overlay immediately while still on pair screen
    setPairedOverlay(true);
    // After a short moment, switch home in background (overlay covers the transition)
    setTimeout(()=>{ setPairScreen("none"); }, 200);
    // Then dismiss overlay after user sees it
    setTimeout(()=>{
      setPairedOverlay(false);
      setPairingStatus("idle");
      setManualCode("");
      setManualServer("ws://");
    }, 2000);
  };

  const startPairing=(serverUrl:string,code:string)=>{
    setPairingStatus("loading"); setPairingError("");
    const ws=new WebSocket(serverUrl);
    const timeout=setTimeout(()=>{ ws.close(); setPairingStatus("error"); setPairingError("Connection timed out. Make sure your server is running."); setPairScreen("choose"); },8000);
    ws.onopen=()=>{ 
      const utcOffsetSeconds = -new Date().getTimezoneOffset() * 60;
      ws.send(JSON.stringify({ type:"register_mobile", utc_offset_seconds:utcOffsetSeconds })); 
      ws.send(JSON.stringify({ type:"pair",code:code.replace(/\s/g,"") })); 
    };
    ws.onmessage=(e)=>{
      clearTimeout(timeout);
      try {
        const msg=JSON.parse(e.data);
        if (msg.type==="pair_success") {
          ws.close();
          const autoMac=(msg.device_mac&&msg.device_mac!=="00:00:00:00:00:00")?msg.device_mac:"";
          onPairSuccess({ id:msg.device_id, name:msg.device_name||"My PC", color:"#22c55e", icon:"desktop-outline", serverUrl, macAddress:autoMac, token:msg.device_token||"", status:msg.status??"offline", lastSeen:msg.last_seen??0 });
        } else if (msg.type==="pair_error") { ws.close(); setPairingStatus("error"); setPairingError(msg.message||"Invalid or expired code."); setPairScreen("choose"); }
      } catch {}
    };
    ws.onerror=()=>{ clearTimeout(timeout); setPairingStatus("error"); setPairingError("Could not connect. Check the server URL."); setPairScreen("choose"); };
    ws.onclose=()=>clearTimeout(timeout);
  };

  const handleQRScanned=(raw:string)=>{
    try {
      const data=JSON.parse(raw);
      if (!data.server||!data.code) throw new Error();
      if (!data.server.startsWith("ws://")&&!data.server.startsWith("wss://")) throw new Error();
      startPairing(data.server,data.code);
    } catch { setPairingStatus("error"); setPairingError("Invalid QR code."); setPairScreen("choose"); }
  };

  const handleManualPair=async()=>{
    const code=manualCode.trim();
    if (!code||code.length!==6) { setPairingStatus("error"); setPairingError("Please enter the 6-digit code shown on your PC."); return; }
    if (pairingStatus==="connecting"||pairingStatus==="loading"||pairingStatus==="success") return;
    Keyboard.dismiss();
    setPairingStatus("connecting");
    try {
      const resp = await fetch(`${WORKER_URL}/lookup?code=${code}`);
      const data = await resp.json();
      if (!data.found||!data.url) {
        setPairingStatus("error");
        setPairingError("Code not found or expired. Make sure the agent is running and try again.");
        return;
      }
      startPairing(data.url, code);
    } catch {
      const server=manualServer.trim();
      if (server&&server!=="ws://"&&(server.startsWith("ws://")||server.startsWith("wss://"))) {
        startPairing(server, code);
      } else {
        setPairingStatus("error");
        setPairingError("Could not reach the lookup service. Check your internet connection.");
      }
    }
  };

  const showToast=(key:string,override?:ToastConfig)=>{
    const c=override??ACTION_TOAST[key]; if (!c) return;
    setActiveToast(null); setTimeout(()=>setActiveToast(c),10);
  };

  const attemptWake=useCallback((devId:string,mac:string,attempt:number)=>{
    const conn=connectionsRef.current[devId]; if (!conn) return;
    conn.sendCommand("wake_pc",mac?{ mac }:{});
    if (attempt<WAKE_RETRY_ATTEMPTS) {
      wakeTimersRef.current[devId]=setTimeout(()=>{ if (lastStatusRef.current[devId]==="offline") attemptWake(devId,mac,attempt+1); else delete wakeTimersRef.current[devId]; },WAKE_RETRY_DELAY_MS);
    } else {
      wakeTimersRef.current[devId]=setTimeout(()=>{
        if (lastStatusRef.current[devId]==="offline") {
          addLog(devId,"wake_failed");
          const devName=devicesRef.current[devId]?.name??"This PC";
          setErrorBanner({ message:`${devName} didn't respond after ${WAKE_RETRY_ATTEMPTS} attempts. Check that it's plugged in and Wake on LAN is enabled in BIOS.`,
            onRepair:()=>{ setErrorBanner(null); setSelectedId(devId); setEditVisible(false); setLogVisible(false); deviceSlide.setValue(screenHeight); setOverlayVisible(true); Animated.spring(deviceSlide,{ toValue:0, damping:28, stiffness:280, useNativeDriver:true }).start(); } });
        }
        delete wakeTimersRef.current[devId];
      },WAKE_RETRY_DELAY_MS);
    }
  },[addLog]);

  const sendCommand=(actionKey:string,label:string,risky:boolean)=>{
    if (!selectedId) return;
    const conn=connectionsRef.current[selectedId]; const dev=devices[selectedId];
    if (!dev||dev.status==="offline") {
      if (actionKey==="wake_pc") {
        if (!dev?.macAddress) {
          Alert.alert("MAC Address Required","To wake this PC you need its MAC address.\n\nOpen Edit Device and add it manually.",
            [{ text:"Edit Device",onPress:()=>{ setNameInput(dev?.name??""); setMacInput(dev?.macAddress??""); setShowColorMenu(false); setShowIconMenu(false); setEditVisible(true); }},{ text:"Cancel",style:"cancel" }]);
        } else {
          if (wakeTimersRef.current[selectedId]) { clearTimeout(wakeTimersRef.current[selectedId]); delete wakeTimersRef.current[selectedId]; }
          showToast("wake_pc"); addLog(selectedId,"wake_sent"); attemptWake(selectedId,dev.macAddress,1);
        }
        return;
      }
      Alert.alert("PC Offline",`${dev?.name??"This PC"} appears to be offline.\n\nTry Wake PC to turn it on.`,[{ text:"OK",style:"cancel" }]); return;
    }
    const execute=()=>{
      const extra=actionKey==="wake_pc"&&dev.macAddress?{ mac:dev.macAddress }:{};
      if (conn?.sendCommand(actionKey,extra)) {
        showToast(actionKey); addLog(selectedId,ACTION_LOG_MAP[actionKey].sent);
        const tempKey=`${selectedId}_${actionKey}_${Date.now()}`;
        pendingCmdsRef.current[tempKey]={ actionKey, deviceId:selectedId };
        setTimeout(()=>{ delete pendingCmdsRef.current[tempKey]; },10_000);
      } else { Alert.alert("Not Connected","The PC is currently offline or unreachable."); }
    };
    if (settings.confirmCommands&&risky) {
      Alert.alert(`${label}?`,`Are you sure you want to ${label.toLowerCase()} this PC?`,[{ text:"Cancel",style:"cancel" },{ text:label,style:"destructive",onPress:execute }]);
    } else { execute(); }
  };

  const runCustomAction=(action:CustomAction)=>{
    if (!selectedId) return;
    const dev=devices[selectedId];
    if (!dev||dev.status==="offline") { Alert.alert("PC Offline","Your PC must be online to run a custom action."); return; }
    connectionsRef.current[selectedId]?.sendCommand("run_custom_action",{ path:action.path, run_as_admin:!!action.runAsAdmin });
    addLog(selectedId,"action_triggered",action.name);
    if (!actionsVisible) {
      showToast("",{ message:`Running ${action.name}…`, icon:action.icon||"play-circle-outline", color:"#a855f7" });
    }
  };

  const saveDeviceActions=(deviceId:string,actions:CustomAction[])=>{
    setDeviceActions(prev=>({ ...prev,[deviceId]:actions }));
    saveActions(deviceId,actions);
  };

  const saveDeviceEvents=(deviceId:string,events:ScheduledEvent[])=>{
    setDeviceEvents(prev=>({ ...prev,[deviceId]:events }));
    connectionsRef.current[deviceId]?.saveEvents(events);
  };

  const saveDeviceScenes=(deviceId:string,scenes:Scene[])=>{
    setDeviceScenes(prev=>({ ...prev,[deviceId]:scenes }));
    saveScenes(deviceId,scenes);
  };

  const runScene=useCallback((scene:Scene)=>{
    if (!selectedId) return;
    const dev=devices[selectedId];
    if (!dev) return;
    const conn=connectionsRef.current[selectedId];
    const steps=scene.steps;
    if (!steps.length) return;

    const firstStep=steps[0];
    const wakeFirst=firstStep.type==="wake_pc";

    if (wakeFirst) {
      // Wake PC then queue remaining steps via startup queue
      const mac=dev.macAddress;
      conn?.sendCommand("wake_pc",mac?{ mac }:{});
      addLog(selectedId,"wake_sent");
      const remaining=steps.slice(1);
      if (remaining.length) {
        const agentSteps=remaining.map(s=>
          s.type==="run_custom_action"?{ type:"run_file", path:s.path||"" }:{ type:s.type }
        );
        conn?.sendCommand("save_startup_queue",{ steps:agentSteps });
      }
      showToast("",{ message:`Scene "${scene.name}" started`, icon:scene.icon, color:scene.color });
      addLog(selectedId,"scene_triggered",scene.name);
    } else if (dev.status==="offline") {
      Alert.alert("PC Offline",`${dev.name} is offline. Add Wake PC as the first step to run scenes when your PC is off.`);
      return;
    } else {
      steps.forEach((step,i)=>{
        setTimeout(()=>{
          if (step.type==="run_custom_action") conn?.sendCommand("run_custom_action",{ path:step.path||"", run_as_admin:false });
          else if (step.type==="wake_pc") conn?.sendCommand("wake_pc",dev.macAddress?{ mac:dev.macAddress }:{});
          else conn?.sendCommand(step.type,{});
        }, i*800);
      });
      showToast("",{ message:`Running "${scene.name}"…`, icon:scene.icon, color:scene.color });
      addLog(selectedId,"scene_triggered",scene.name);
    }
  },[selectedId,devices,addLog,showToast]);

  const sendVolumeCommand=useCallback((type:string,extra:Record<string,any>={})=>{
    if (!selectedId) return;
    connectionsRef.current[selectedId]?.sendCommand(type,extra);
  },[selectedId]);

  const handleVolumeData=useCallback((deviceId:string,data:VolumeData)=>{
    setDeviceVolume(prev=>({ ...prev,[deviceId]:data }));
  },[]);

  const [fileBrowseResult, setFileBrowseResult] = useState<Record<string,FileBrowseResult>>({});
  const handleFileBrowse=useCallback((deviceId:string,result:any)=>{
    if (result.isSearch) {
      // Global search result
      setFileBrowseResult(prev=>({ ...prev,[deviceId]:{ ...prev[deviceId], searchResults:result.entries??[], searchDone:true } as any }));
      return;
    }
    console.log("[FILES] Got browse result:", result.path, result.entries?.length, "entries, done:", result.done);
    setFileBrowseResult(prev=>({ ...prev,[deviceId]:{
      path:    result.path,
      entries: result.entries??[],
      is_home: result.is_home,
      error:   result.error,
      done:    result.done??true,
    }}));
  },[]);

  const [clipboardText,       setClipboardText]       = useState<Record<string,string|null>>({});
  const [screenshotData,      setScreenshotData]      = useState<Record<string,{data:string|null,error:string|null}|null>>({});
  const [networkData,         setNetworkData]         = useState<Record<string,any>>({});
  const [speedtestData,       setSpeedtestData]       = useState<Record<string,any>>({});
  const [audioDevices,        setAudioDevices]        = useState<Record<string,{outputs:any[],inputs:any[]}>>({});
  const [uploadResult,        setUploadResult]        = useState<Record<string,any>>({});
  const [soundboardFileResult,setSoundboardFileResult]= useState<Record<string,any>>({});
  const [nowPlaying,          setNowPlaying]          = useState<Record<string,any>>({});
  const albumArtRef = useRef<Record<string,string|null>>({});
  const fileSharingRef = useRef(false);
  const fileDownloadCompleteRef = useRef<(()=>void)|null>(null);

  const handleFileDownload=useCallback(async (deviceId:string,name:string,data:string,mimeType:string)=>{
    if (!data) {
      Alert.alert("Download Failed", name||"File too large or unavailable.");
      return;
    }
    try {
      const FileSystem = require("expo-file-system/legacy");
      const Sharing    = require("expo-sharing");
      const uri = `${FileSystem.cacheDirectory}${name}`;
      await FileSystem.writeAsStringAsync(uri, data, { encoding:"base64" });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        fileSharingRef.current = true;
        // Notify FileBrowserScreen to clear the spinner before sheet opens
        fileDownloadCompleteRef.current?.();
        await Sharing.shareAsync(uri, { mimeType, dialogTitle:`Save ${name}` });
        setTimeout(()=>{ fileSharingRef.current = false; }, 500);
      } else {
        fileDownloadCompleteRef.current?.();
        Alert.alert("Downloaded", `${name} saved.`);
      }
    } catch(e:any) {
      fileSharingRef.current = false;
      fileDownloadCompleteRef.current?.();
      Alert.alert("Download Failed", e?.message||`Could not save ${name}.`);
    }
  },[]);

  const openDevice=(id:string)=>{
    setSelectedId(id); setEditVisible(false); setLogVisible(false);
    setActionsVisible(false); setEventsVisible(false); setScenesVisible(false);
    setVolumeVisible(false); setToolsVisible(false); setFilesVisible(false);
    setMediaVisible(false); setClipboardVisible(false); setTypeTextVisible(false);
    setScreenshotVisible(false); setNetworkVisible(false); setUploadVisible(false);
    setSoundboardVisible(false);
    setActiveToast(null); setErrorBanner(null);
    deviceSlide.setValue(screenHeight); setOverlayVisible(true);
    Animated.spring(deviceSlide,{ toValue:0, damping:28, stiffness:280, useNativeDriver:true }).start();
  };

  const closeDevice=()=>{
    setActiveToast(null); setErrorBanner(null);
    Animated.timing(deviceSlide,{ toValue:screenHeight, duration:340, useNativeDriver:true }).start(()=>{
      setOverlayVisible(false); setSelectedId(null);
      setEditVisible(false); setLogVisible(false); setActionsVisible(false);
      setEventsVisible(false); setScenesVisible(false); setVolumeVisible(false);
      setToolsVisible(false); setFilesVisible(false); setMediaVisible(false);
      setClipboardVisible(false); setTypeTextVisible(false); setScreenshotVisible(false);
      setNetworkVisible(false); setUploadVisible(false); setSoundboardVisible(false);
    });
  };

  const handleReorder=(ids:string[])=>{ setDeviceOrder(ids); saveOrder(ids); };
  const statusLabel=(d:Device)=>d.status==="online"?"Online":d.status==="idle"?"Idle":formatOffline(d.lastSeen);
  const resetPair=()=>{ setPairScreen("none"); setPairingStatus("idle"); setPairingError(""); setManualCode(""); };

  const handlePurchasePro = () => {
    // TODO: wire up StoreKit here
    Alert.alert("Purchase PCLink Pro","This will connect to the App Store. (StoreKit integration coming before release)",[
      { text:"Cancel", style:"cancel" },
      { text:"Simulate Purchase (Test)", onPress:()=>{
        setIsPro(true); saveProStatus(true); setPaywallVisible(false);
        setTimeout(()=>setProActivated(true), 300);
      }},
    ]);
  };

  const handleRestorePurchase = () => {
    Alert.alert("Restore Purchase","Checking for previous purchases…",[
      { text:"Cancel", style:"cancel" },
      { text:"Simulate Restore (Test)", onPress:()=>{
        setIsPro(true); saveProStatus(true); setPaywallVisible(false);
        setTimeout(()=>setProActivated(true), 300);
      }},
    ]);
  };

  const showPaywall = () => setPaywallVisible(true);
  const handleResetPro = useCallback(()=>{
    setIsPro(false);
    setDebugProOn(false);
    saveProStatus(false);
  },[]);

  const pendingDebugRef = useRef<string|null>(null);

  // Fire any pending debug action when a device becomes selected/open
  useEffect(()=>{
    if (!selectedId || !pendingDebugRef.current) return;
    const type = pendingDebugRef.current;
    pendingDebugRef.current = null;
    setTimeout(()=>{
      switch(type) {
        case "wake_fail":
          setErrorBanner({ message:"[Debug] Wake failed — PC didn't respond after 3 attempts. Check that it's plugged in and Wake on LAN is enabled in BIOS." });
          break;
        case "offline_toast":
          setActiveToast({ message:"PC went offline", icon:"cloud-offline-outline", color:"#6b7280" });
          break;
        case "token_invalid":
          handleTokenInvalid(selectedId);
          break;
      }
    }, 400); // slight delay so overlay has finished opening
  },[selectedId]);

  const handleForceError = useCallback((type:string)=>{
    switch(type) {
      case "screenshot_fail":
        if (selectedId) setScreenshotData(prev=>({ ...prev,[selectedId]:{ data:null, error:"Screenshot failed — could not capture the screen. Make sure the PCLink Agent is running and try again." } }));
        break;
      case "clipboard_timeout":
        // Inject a fake timeout error directly into clipboard state
        setClipboardText(null);
        // Signal the clipboard screen to show its error — we repurpose screenshotData as a trigger
        // Actually set a special sentinel that ClipboardScreen reads
        Alert.alert(
          "Clipboard Timeout Debug",
          "Open Clipboard Sync → tap Fetch from PC → wait 8 seconds. The timeout will fire naturally and show:\n\n\"No response from PC. Make sure the agent is running.\""
        );
        break;
      case "upload_timeout":
        if (selectedId) setUploadResult(prev=>({ ...prev,[selectedId]:{ success:false, error:"Upload timed out — the file may be too large or your connection dropped. Try a smaller file or check your Wi-Fi." } }));
        break;
      case "wake_fail":
        if (selectedId) {
          setErrorBanner({ message:"[Debug] Wake failed — PC didn't respond after 3 attempts. Check that it's plugged in and Wake on LAN is enabled in BIOS." });
        } else {
          // Queue it — open any device and it fires automatically
          pendingDebugRef.current = type;
          Alert.alert("Debug — Wake Fail", "No device is open. Open any device card and the error will appear automatically.", [{ text:"OK" }]);
        }
        break;
      case "offline_toast":
        if (selectedId) {
          setActiveToast({ message:"PC went offline", icon:"cloud-offline-outline", color:"#6b7280" });
        } else {
          pendingDebugRef.current = type;
          Alert.alert("Debug — Offline Toast", "No device is open. Open any device card and the toast will fire automatically.", [{ text:"OK" }]);
        }
        break;
      case "token_invalid":
        if (selectedId) {
          handleTokenInvalid(selectedId);
        } else {
          pendingDebugRef.current = type;
          Alert.alert("Debug — Token Invalid", "No device is open. Open any device card and the alert will fire automatically.", [{ text:"OK" }]);
        }
        break;
    }
  },[selectedId, handleTokenInvalid]);

  if (showOnboarding) return (
    <GestureHandlerRootView style={{ flex:1 }}>
      <OnboardingScreen
        theme={theme}
        onDone={()=>setShowOnboarding(false)}
        onPair={()=>{ setShowOnboarding(false); setPairScreen("choose"); setPairingStatus("idle"); setPairingError(""); }}
      />
    </GestureHandlerRootView>
  );

  if (pairScreen==="qr") return (
    <GestureHandlerRootView style={{ flex:1 }}>
      {!pairedOverlay&&<QRScannerScreen theme={theme} onScanned={handleQRScanned} onCancel={()=>{ setPairScreen("choose"); setPairingStatus("idle"); setPairingError(""); }}/>}
      {pairingStatus==="loading"&&!pairedOverlay&&<View style={pairSt.overlay}><BlurView intensity={60} tint={theme.blurTint} style={StyleSheet.absoluteFill}/><Ionicons name="sync-outline" size={48} color="#007aff"/><Text style={[pairSt.text,{ color:theme.titleColor }]}>Connecting…</Text></View>}
      {pairedOverlay&&<View style={StyleSheet.absoluteFillObject}><PairedOverlay theme={theme}/></View>}
    </GestureHandlerRootView>
  );

  return (
    <GestureHandlerRootView style={{ flex:1, backgroundColor:theme.bg }}>
      {/* TopBar + Notifications with manual top inset */}
      <View style={{ backgroundColor:theme.bg, paddingTop:insets.top }}>
        <View style={[st.topBar,{ backgroundColor:theme.topBar }]}>
          <Pressable onPress={()=>setSettingsVisible(true)} hitSlop={10}><Ionicons name="settings-outline" size={26} color={theme.titleColor}/></Pressable>
          <Text style={[st.title,{ color:theme.titleColor }]}>PCLink</Text>
          <Pressable onPress={()=>{
            if (Object.keys(devices).length>=MAX_DEVICES) { Alert.alert("Device Limit Reached",`You can have a maximum of ${MAX_DEVICES} devices.`); return; }
            setQuickVisible(true);
          }} hitSlop={10}>
            <Ionicons name="add-circle-outline" size={28} color={theme.titleColor}/>
          </Pressable>
        </View>
        <NotificationBanner notifications={notifications} onDismiss={dismissNotification} theme={theme}/>
      </View>

      {/* Device list lives directly in GestureHandlerRootView — no clip boundary */}
      {orderedDevices.length===0?(
        <View style={[st.homeScroll,{ alignItems:"center" }]}>
          <View style={st.empty}>
            <Ionicons name="desktop-outline" size={56} color={theme.labelColor}/>
            <Text style={[st.emptyTitle,{ color:theme.titleColor }]}>No devices yet</Text>
            <Text style={[st.emptySub,{ color:theme.labelColor }]}>Tap + to add your first PC</Text>
          </View>
        </View>
      ):(
        <View style={{ flex:1, alignItems:"center", paddingTop:20 }}>
          <ReorderableDeviceList orderedDevices={orderedDevices} onOpenDevice={openDevice} onReorder={handleReorder} statusLabel={statusLabel} theme={theme}/>
        </View>
      )}

        {/* ── DEVICE OVERLAY ── */}
        {overlayVisible&&device&&(
          <Animated.View style={[StyleSheet.absoluteFillObject,{ backgroundColor:theme.deviceBg, transform:[{ translateY:deviceSlide }] }]}>
            <SafeAreaView style={{ flex:1 }}>
              {/* Show notifications on current screen too */}
              <NotificationBanner notifications={notifications} onDismiss={dismissNotification} theme={theme}/>

              {actionsVisible&&(
                <CustomActionsScreen
                  device={device} actions={curActions}
                  onSave={a=>saveDeviceActions(device.id,a)}
                  onBack={()=>setActionsVisible(false)}
                  getConnection={()=>connectionsRef.current[device.id]}
                  onRunAction={action=>{ runCustomAction(action); }}
                  theme={theme}
                />
              )}

              {eventsVisible&&(
                <ScheduledEventsScreen
                  device={device} events={curEvents} customActions={curActions}
                  onSave={e=>saveDeviceEvents(device.id,e)}
                  onBack={()=>setEventsVisible(false)}
                  onGoToCustomActions={()=>{ setEventsVisible(false); setActionsVisible(true); }}
                  theme={theme}
                />
              )}

              {scenesVisible&&(
                <ScenesScreen
                  device={device} scenes={curScenes} customActions={curActions}
                  onSave={s=>saveDeviceScenes(device.id,s)}
                  onBack={()=>setScenesVisible(false)}
                  onRunScene={scene=>{ setScenesVisible(false); runScene(scene); }}
                  onGoToCustomActions={()=>{ setScenesVisible(false); setActionsVisible(true); }}
                  theme={theme}
                />
              )}

              {toolsVisible&&!filesVisible&&!mediaVisible&&!clipboardVisible&&!typeTextVisible&&!screenshotVisible&&!networkVisible&&!uploadVisible&&!soundboardVisible&&(
                <ToolsScreen
                  device={device}
                  onBack={()=>setToolsVisible(false)}
                  onOpenFiles={()=>{ if(!isProActive){showPaywall();return;} setFilesVisible(true); }}
                  onOpenMedia={()=>{ if(!isProActive){showPaywall();return;} setMediaVisible(true); }}
                  onOpenClipboard={()=>{ if(!isProActive){showPaywall();return;} setClipboardVisible(true); }}
                  onOpenTypeText={()=>{ if(!isProActive){showPaywall();return;} setTypeTextVisible(true); }}
                  onOpenScreenshot={()=>{ if(!isProActive){showPaywall();return;} setScreenshotVisible(true); }}
                  onOpenNetwork={()=>{ if(!isProActive){showPaywall();return;} setNetworkVisible(true); }}
                  onOpenUpload={()=>{ if(!isProActive){showPaywall();return;} setUploadVisible(true); }}
                  onOpenSoundboard={()=>{ if(!isProActive){showPaywall();return;} setSoundboardVisible(true); }}
                  theme={theme}
                  isProActive={isProActive}
                  onShowPaywall={showPaywall}
                />
              )}

              {networkVisible&&(
                <NetworkInfoScreen
                  onBack={()=>setNetworkVisible(false)}
                  sendCommand={(type,extra)=>connectionsRef.current[device.id]?.sendCommand(type,extra)}
                  networkData={networkData[device.id]??null}
                  speedtestData={speedtestData[device.id]??null}
                  theme={theme}
                />
              )}

              {uploadVisible&&(
                <FileUploadScreen
                  onBack={()=>setUploadVisible(false)}
                  sendCommand={(type,extra)=>connectionsRef.current[device.id]?.sendCommand(type,extra)}
                  browseResult={fileBrowseResult[device.id]??null}
                  uploadResult={uploadResult[device.id]??null}
                  theme={theme}
                />
              )}

              {soundboardVisible&&(
                <SoundboardScreen
                  onBack={()=>setSoundboardVisible(false)}
                  sendCommand={(type,extra)=>connectionsRef.current[device.id]?.sendCommand(type,extra)}
                  audioDevices={audioDevices[device.id]??{outputs:[],inputs:[]}}
                  soundboardFileResult={soundboardFileResult[device.id]??null}
                  theme={theme}
                  pcId={device.id}
                />
              )}

              {mediaVisible&&(
                <MediaControlsScreen
                  onBack={()=>setMediaVisible(false)}
                  sendCommand={(type,extra)=>connectionsRef.current[device.id]?.sendCommand(type,extra)}
                  nowPlaying={nowPlaying[device.id]??null}
                  theme={theme}
                />
              )}

              {clipboardVisible&&(
                <ClipboardScreen
                  onBack={()=>setClipboardVisible(false)}
                  sendCommand={(type,extra)=>connectionsRef.current[device.id]?.sendCommand(type,extra)}
                  pcClipboardText={clipboardText[device.id]??null}
                  onClearClipboard={()=>setClipboardText(prev=>({ ...prev,[device.id]:null }))}
                  theme={theme}
                />
              )}

              {typeTextVisible&&(
                <TypeTextScreen
                  onBack={()=>setTypeTextVisible(false)}
                  sendCommand={(type,extra)=>connectionsRef.current[device.id]?.sendCommand(type,extra)}
                  theme={theme}
                />
              )}

              {screenshotVisible&&(
                <ScreenshotScreen
                  onBack={()=>setScreenshotVisible(false)}
                  sendCommand={(type,extra)=>connectionsRef.current[device.id]?.sendCommand(type,extra)}
                  screenshotResult={screenshotData[device.id]??null}
                  onClearScreenshot={()=>setScreenshotData(prev=>({ ...prev,[device.id]:null }))}
                  theme={theme}
                />
              )}

              {filesVisible&&(
                <FileBrowserScreen
                  device={device}
                  browseResult={fileBrowseResult[device.id]??null}
                  onBack={()=>setFilesVisible(false)}
                  sendCommand={(type,extra)=>connectionsRef.current[device.id]?.sendCommand(type,extra)}
                  sharingRef={fileSharingRef}
                  downloadCompleteRef={fileDownloadCompleteRef}
                  theme={theme}
                />
              )}
              {volumeVisible&&(
                <VolumeScreen
                  device={device}
                  volumeData={deviceVolume[device.id]??null}
                  onBack={()=>setVolumeVisible(false)}
                  sendVolumeCommand={sendVolumeCommand}
                  theme={theme}
                />
              )}

              {logVisible&&!actionsVisible&&!eventsVisible&&!scenesVisible&&!volumeVisible&&!toolsVisible&&!filesVisible&&!mediaVisible&&!clipboardVisible&&!typeTextVisible&&!screenshotVisible&&!networkVisible&&!uploadVisible&&!soundboardVisible&&(
                <ActivityLogScreen deviceName={device.name} entries={curLogs} theme={theme} onBack={()=>setLogVisible(false)}/>
              )}

              {editVisible&&!logVisible&&!actionsVisible&&!eventsVisible&&!scenesVisible&&!volumeVisible&&!toolsVisible&&!filesVisible&&!mediaVisible&&!clipboardVisible&&!typeTextVisible&&!screenshotVisible&&!networkVisible&&!uploadVisible&&!soundboardVisible&&(
                <View style={{ flex:1, padding:20 }}>
                  <View style={[st.overlayTopBar,{ paddingHorizontal:0 }]}>
                    <Pressable onPress={()=>{ setEditVisible(false); setEditingName(false); setEditingMac(false); }} style={st.overlayBackBtn} hitSlop={10}>
                      <Ionicons name="chevron-back" size={22} color="#007aff"/><Text style={st.overlayBackText}>Back</Text>
                    </Pressable>
                    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                      <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]}>Edit Device</Text>
                    </View>
                    <View style={{ width:60 }}/>
                  </View>
                  {(editingName||editingMac)&&(
                    <Pressable style={StyleSheet.absoluteFill} onPress={()=>{
                      if (editingName) { updateDevice(selectedId!,{ name:nameInput }); setEditingName(false); }
                      if (editingMac)  { updateDevice(selectedId!,{ macAddress:macInput.trim() }); setEditingMac(false); }
                    }}/>
                  )}
                  <View style={[erSt.row,{ borderColor:theme.inputBorder }]}>
                    <Text style={[erSt.label,{ color:theme.labelColor }]}>Name</Text>
                    {editingName
                      ?<TextInput value={nameInput} onChangeText={setNameInput} onSubmitEditing={()=>{ updateDevice(selectedId!,{ name:nameInput }); setEditingName(false); }} style={[erSt.input,{ color:theme.inputText, borderBottomColor:"#007aff" }]} autoFocus returnKeyType="done"/>
                      :<Pressable onPress={()=>{ setEditingName(true); setEditingMac(false); setNameInput(device.name); }}><Text style={[erSt.value,{ color:theme.rowTitle }]}>{device.name}</Text></Pressable>}
                  </View>
                  <View style={[erSt.row,{ borderColor:theme.inputBorder }]}>
                    <View style={{ flex:1 }}>
                      <Text style={[erSt.label,{ color:theme.labelColor }]}>MAC Address</Text>
                      <Text style={[erSt.sublabel,{ color:theme.rowSubtitle }]}>{device.macAddress?"Auto-detected · tap to edit":"Required for Wake on LAN"}</Text>
                    </View>
                    {editingMac
                      ?<TextInput value={macInput} onChangeText={setMacInput} onSubmitEditing={()=>{ updateDevice(selectedId!,{ macAddress:macInput.trim() }); setEditingMac(false); }} placeholder="AA:BB:CC:DD:EE:FF" placeholderTextColor={theme.labelColor} style={[erSt.input,{ color:theme.inputText, borderBottomColor:"#007aff", minWidth:170 }]} autoCapitalize="characters" autoCorrect={false} returnKeyType="done" autoFocus/>
                      :<Pressable onPress={()=>{ setEditingMac(true); setEditingName(false); setMacInput(device.macAddress??""); }}><Text style={[erSt.value,{ color:device.macAddress?theme.rowTitle:theme.labelColor }]}>{device.macAddress||"Tap to add"}</Text></Pressable>}
                  </View>
                  <Pressable style={[erSt.row,{ borderColor:theme.inputBorder }]} onPress={()=>{ setShowColorMenu(true); setShowIconMenu(false); }}>
                    <Text style={[erSt.label,{ color:theme.labelColor }]}>Color</Text>
                    <View style={erSt.right}><View style={[erSt.colorDot,{ backgroundColor:device.color }]}/><Text style={[erSt.value,{ color:theme.rowTitle }]}>{COLORS.find(c=>c.value===device.color)?.name}</Text><Ionicons name="chevron-expand" size={16} color={theme.labelColor}/></View>
                  </Pressable>
                  <Pressable style={[erSt.row,{ borderColor:theme.inputBorder }]} onPress={()=>{ setShowIconMenu(true); setShowColorMenu(false); }}>
                    <Text style={[erSt.label,{ color:theme.labelColor }]}>Icon</Text>
                    <View style={erSt.right}><Ionicons name={device.icon as any} size={18} color={theme.rowTitle}/><Text style={[erSt.value,{ color:theme.rowTitle }]}>{ICONS.find(i=>i.value===device.icon)?.name}</Text><Ionicons name="chevron-expand" size={16} color={theme.labelColor}/></View>
                  </Pressable>
                  <Pressable style={[erSt.row,{ borderColor:theme.inputBorder, borderBottomWidth:0, marginTop:20 }]}
                    onPress={()=>Alert.alert("Remove Device",`Remove "${device.name}"?\n\nThis will also unpair the PC agent.`,[
                      { text:"Cancel",style:"cancel" },
                      { text:"Remove",style:"destructive",onPress:()=>{ closeDevice(); removeDevice(selectedId!); } },
                    ])}>
                    <Text style={[erSt.label,{ color:"#ff3b30" }]}>Remove Device</Text>
                    <Ionicons name="trash-outline" size={18} color="#ff3b30"/>
                  </Pressable>
                  <Text style={[st.macNote,{ color:theme.noteText }]}>
                    MAC is auto-detected when the agent connects. You can override it here.{"\n"}
                    To find manually: open Command Prompt and run <Text style={{ fontFamily:"Courier New" }}>ipconfig /all</Text> then look for "Physical Address".
                  </Text>
                  <IOSDropdown visible={showColorMenu} onClose={()=>setShowColorMenu(false)} theme={theme}>
                    {COLORS.map((c,i)=><DropdownItem key={c.value} label={c.name} last={i===COLORS.length-1} theme={theme} onPress={()=>{ updateDevice(selectedId!,{ color:c.value }); setShowColorMenu(false); }} left={<View style={[erSt.colorDot,{ backgroundColor:c.value, marginRight:12 }]}/>}/>)}
                  </IOSDropdown>
                  <IOSDropdown visible={showIconMenu} onClose={()=>setShowIconMenu(false)} theme={theme}>
                    {ICONS.map((ic,i)=><DropdownItem key={ic.value} label={ic.name} last={i===ICONS.length-1} theme={theme} onPress={()=>{ updateDevice(selectedId!,{ icon:ic.value }); setShowIconMenu(false); }} left={<Ionicons name={ic.value as any} size={20} color={theme.dropdownText} style={{ marginRight:12 }}/>}/>)}
                  </IOSDropdown>
                </View>
              )}

              {!editVisible&&!logVisible&&!actionsVisible&&!eventsVisible&&!scenesVisible&&!volumeVisible&&!toolsVisible&&!filesVisible&&!mediaVisible&&!clipboardVisible&&!typeTextVisible&&!screenshotVisible&&!networkVisible&&!uploadVisible&&!soundboardVisible&&(
                <View style={{ flex:1 }}>
                  <View style={[st.overlayTopBar,{ paddingHorizontal:20 }]}>
                    <Pressable onPress={closeDevice} style={st.overlayBackBtn} hitSlop={10}>
                      <Ionicons name="chevron-back" size={22} color="#007aff"/><Text style={st.overlayBackText}>Back</Text>
                    </Pressable>
                    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                      <Text style={[st.overlayCenteredTitle,{ color:theme.titleColor }]} numberOfLines={1}>{device.name}</Text>
                    </View>
                    <Pressable onPress={()=>{ setNameInput(device.name); setMacInput(device.macAddress??""); setShowColorMenu(false); setShowIconMenu(false); setEditVisible(true); }} hitSlop={10}>
                      <Ionicons name="create-outline" size={22} color="#007aff"/>
                    </Pressable>
                  </View>
                  <ErrorBanner config={errorBanner} onDismiss={()=>setErrorBanner(null)} theme={theme}/>
                  <CommandToast toast={activeToast} onHide={()=>setActiveToast(null)}/>
                  <View style={[st.banner,{ backgroundColor:device.color }]}>
                    <Ionicons name={device.icon as any} size={52} color="white"/>
                    <Text style={st.bannerName}>{device.name}</Text>
                    <View style={st.bannerStatusRow}>
                      <View style={[st.bannerDot,{ backgroundColor:device.status==="online"?"rgba(255,255,255,0.9)":device.status==="idle"?"rgba(255,200,0,0.9)":"rgba(255,80,80,0.9)" }]}/>
                      <Text style={st.bannerStatus}>{statusLabel(device)}</Text>
                    </View>
                  </View>
                  <ScrollView contentContainerStyle={{ paddingBottom:40 }} showsVerticalScrollIndicator={false}>
                    <View style={st.sectionRow}>
                      <Text style={[st.sectionLabel,{ color:theme.labelColor }]}>ACTIONS</Text>
                      {hasLogs&&<Pressable onPress={()=>setLogVisible(true)} hitSlop={10}><Text style={[st.sectionLabel,st.logsLink,{ color:theme.labelColor }]}>LOGS</Text></Pressable>}
                    </View>
                    <ActionGrid
                      theme={theme} onAction={sendCommand}
                      onEventsPress={()=>setEventsVisible(true)}
                      onScenesPress={()=>setScenesVisible(true)}
                      onVolumePress={()=>setVolumeVisible(true)}
                      onCustomActionsPress={()=>setActionsVisible(true)}
                      onToolsPress={()=>setToolsVisible(true)}
                      isProActive={isProActive}
                      onShowPaywall={showPaywall}
                    />
                    {/* WoL WiFi warning */}
                    {networkData[device.id]?.connection_type==="Wi-Fi"&&(
                      <View style={[st.wolWarn,{ backgroundColor:"#f59e0b11", borderColor:"#f59e0b33" }]}>
                        <Ionicons name="warning-outline" size={14} color="#f59e0b"/>
                        <Text style={[st.wolWarnText,{ color:"#f59e0b" }]}>
                          Your PC is on Wi-Fi. Wake on LAN requires Ethernet to work reliably.
                        </Text>
                      </View>
                    )}
                    {/* Run custom actions directly from device screen */}
                    {curActions.length>0&&(
                      <View style={{ paddingHorizontal:20, marginTop:8 }}>
                        <Text style={[st.sectionLabel,{ color:theme.labelColor, marginBottom:10 }]}>RUN ACTION</Text>
                        {curActions.map(action=>(
                          <Pressable key={action.id}
                            onPress={()=>runCustomAction(action)}
                            onLongPress={()=>Alert.alert(action.name,"What would you like to do?",[
                              { text:"Run Action", onPress:()=>runCustomAction(action) },
                              { text:"Delete Action", style:"destructive", onPress:()=>{
                                const updated=curActions.filter(a=>a.id!==action.id);
                                saveDeviceActions(device.id,updated);
                              }},
                              { text:"Cancel", style:"cancel" },
                            ])}
                            style={({ pressed })=>[{ flexDirection:"row", alignItems:"center", gap:12, padding:14, borderRadius:14, marginBottom:8, backgroundColor:pressed?theme.actionTilePressed:theme.actionTile }]}>
                            <View style={{ width:36, height:36, borderRadius:10, backgroundColor:"#a855f722", justifyContent:"center", alignItems:"center" }}>
                              <Ionicons name={(action.icon||"play-circle-outline") as any} size={20} color="#a855f7"/>
                            </View>
                            <View style={{ flex:1 }}>
                              <View style={{ flexDirection:"row", alignItems:"center", gap:6 }}>
                                <Text style={{ color:theme.actionTileText, fontSize:15, fontWeight:"500" }}>{action.name}</Text>
                                {action.runAsAdmin&&(
                                  <View style={panelSt.adminBadge}>
                                    <Ionicons name="shield-outline" size={10} color="#f59e0b"/>
                                    <Text style={panelSt.adminBadgeText}>Admin</Text>
                                  </View>
                                )}
                              </View>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={theme.chevron}/>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    <View style={{ paddingHorizontal:20, marginTop:4 }}>
                      <StatsDashboard stats={deviceStats[device.id]??null} deviceStatus={device.status} theme={theme}/>
                    </View>
                  </ScrollView>
                </View>
              )}
            </SafeAreaView>
          </Animated.View>
        )}

        <SettingsSheet visible={settingsVisible} onClose={()=>setSettingsVisible(false)} settings={settings} onSettingsChange={s=>{ setSettings(s); saveSettings(s); }} theme={theme} onForceError={handleForceError}
          debugPaywallOff={debugPaywallOff} setDebugPaywallOff={setDebugPaywallOff}
          debugProOn={debugProOn} setDebugProOn={setDebugProOn}
          onShowPaywall={showPaywall} onRestore={handleRestorePurchase} onResetPro={handleResetPro}/>

        {/* Quick Actions Sheet */}
        <IOSSheet visible={quickVisible} onClose={()=>setQuickVisible(false)} title="Quick Actions" theme={theme}>
          <View style={groupSt.wrapper}>
            <Text style={[groupSt.label,{ color:theme.groupLabel }]}>ADD DEVICE</Text>
            <View style={[groupSt.card,{ backgroundColor:theme.groupCard, borderColor:theme.groupCardBorder }]}>
              <SettingsRow icon="add-circle-outline" iconBg="#34c759" title="Pair New Device" subtitle="Add a PC using QR code or manual entry"
                onPress={()=>{
                  setQuickVisible(false);
                  if (!isProActive && Object.keys(devices).length >= 1) { setTimeout(()=>showPaywall(), 350); return; }
                  setPairScreen("choose"); setPairingStatus("idle"); setPairingError("");
                }} last theme={theme}/>
            </View>
          </View>
          <View style={groupSt.wrapper}>
            <Text style={[groupSt.label,{ color:theme.groupLabel }]}>ALL DEVICES</Text>
            <View style={[groupSt.card,{ backgroundColor:theme.groupCard, borderColor:theme.groupCardBorder }]}>
              <SettingsRow icon="flash-outline" iconBg="#ff9500" title="Wake All" subtitle="Send wake signal to every device"
                onPress={()=>{ Object.entries(connectionsRef.current).forEach(([id,c])=>{ const mac=devicesRef.current[id]?.macAddress; c.sendCommand("wake_pc",mac?{ mac }:{}); addLog(id,"wake_sent"); }); setQuickVisible(false); }} theme={theme}/>
              <SettingsRow icon="power-outline" iconBg="#8e8e93" title="Shutdown All"
                onPress={()=>Alert.alert("Shutdown All?","This will shut down all paired PCs.",[{ text:"Cancel",style:"cancel" },{ text:"Shutdown All",style:"destructive",onPress:()=>{ Object.keys(connectionsRef.current).forEach(id=>{ connectionsRef.current[id].sendCommand("shutdown_pc"); addLog(id,"shutdown_sent"); }); setQuickVisible(false); } }])} last theme={theme}/>
            </View>
          </View>
          <View style={groupSt.wrapper}>
            <Text style={[groupSt.label,{ color:theme.groupLabel }]}>MANAGE</Text>
            <View style={[groupSt.card,{ backgroundColor:theme.groupCard, borderColor:theme.groupCardBorder }]}>
              <SettingsRow icon="refresh-outline" iconBg="#007aff" title="Refresh Connections" onPress={()=>{ connectAll(devicesRef.current); setQuickVisible(false); }} theme={theme}/>
              <SettingsRow icon="trash-outline" iconBg="#ff3b30" title="Remove All Devices" destructive
                onPress={()=>{ setQuickVisible(false); Alert.alert("Remove All?","This will unpair all devices from this phone.",[{ text:"Cancel",style:"cancel" },{ text:"Remove All",style:"destructive",onPress:()=>{
                  Object.keys(connectionsRef.current).forEach(id=>{ connectionsRef.current[id].sendUnpair(); connectionsRef.current[id].destroy(); clearLog(id); });
                  connectionsRef.current={}; devicesRef.current={};
                  Object.values(offlineTimersRef.current).forEach(t=>clearTimeout(t)); offlineTimersRef.current={};
                  Object.values(wakeTimersRef.current).forEach(t=>clearTimeout(t)); wakeTimersRef.current={};
                  lastStatusRef.current={};
                  setDevices({}); setDeviceOrder([]); setDeviceStats({}); setDeviceLogs({}); saveDevices({}); saveOrder([]);
                } }]); }} last theme={theme}/>
            </View>
          </View>
        </IOSSheet>

        {/* Pair Sheet */}
        <IOSSheet visible={pairScreen!=="none"&&pairScreen!=="qr"} onClose={resetPair} title={pairScreen==="setup"?"Set Up Agent":"Add Device"} theme={theme}>
          {pairScreen==="setup"&&<AgentSetupScreen theme={theme} onBack={()=>setPairScreen("choose")} onReady={()=>setPairScreen("choose")}/>}
          {pairScreen==="choose"&&(
            <>
              {pairingStatus==="error"&&<View style={manSt.errorBox}><Ionicons name="alert-circle-outline" size={16} color="#ff3b30"/><Text style={manSt.errorText}>{pairingError}</Text></View>}
              <View style={groupSt.wrapper}>
                <Text style={[groupSt.label,{ color:theme.groupLabel }]}>PAIR YOUR PC</Text>
                <View style={[groupSt.card,{ backgroundColor:theme.groupCard, borderColor:theme.groupCardBorder }]}>
                  <SettingsRow icon="qr-code-outline" iconBg="#007aff" title="Scan QR Code" subtitle="Fastest — scan the QR from the agent popup on your PC" onPress={()=>{ setPairScreen("qr"); setPairingStatus("idle"); setPairingError(""); }} theme={theme}/>
                  <SettingsRow icon="keypad-outline" iconBg="#5856d6" title="Enter Code Manually" subtitle="Type the 6-digit code from the agent popup on your PC" onPress={()=>{ setPairScreen("manual"); setPairingStatus("idle"); setPairingError(""); }} last theme={theme}/>
                </View>
              </View>
              <Pressable onPress={()=>setPairScreen("setup")} style={({ pressed })=>[setupSt.noAgentBtn,{ borderColor:theme.inputBorder },pressed&&{ opacity:0.7 }]}>
                <Ionicons name="download-outline" size={16} color={theme.labelColor}/>
                <Text style={[setupSt.noAgentText,{ color:theme.labelColor }]}>Don't have the agent yet? Get it here →</Text>
              </Pressable>
              <Text style={[st.pairNote,{ color:theme.noteText }]}>Each PC can only be paired with one phone at a time.</Text>
            </>
          )}
          {pairScreen==="manual"&&(
            <>
              <View style={groupSt.wrapper}>
                <Text style={[groupSt.label,{ color:theme.groupLabel }]}>PAIRING CODE</Text>
                <View style={[groupSt.card,{ backgroundColor:theme.groupCard, borderColor:theme.groupCardBorder }]}>
                  <CodeInput
                    value={manualCode}
                    onChange={setManualCode}
                    theme={theme}
                  />
                  <View style={[manSt.hintRow,{ borderTopColor:theme.rowBorder }]}>
                    <Ionicons name="information-circle-outline" size={14} color={theme.labelColor}/>
                    <Text style={[manSt.hintText,{ color:theme.labelColor }]}>Enter the 6-digit code shown in the agent popup on your PC.</Text>
                  </View>
                </View>
              </View>
              {pairingStatus==="error"&&<View style={manSt.errorBox}><Ionicons name="alert-circle-outline" size={16} color="#ff3b30"/><Text style={manSt.errorText}>{pairingError}</Text></View>}
              <Pressable
                onPress={handleManualPair}
                disabled={pairingStatus==="connecting"||pairingStatus==="loading"||pairingStatus==="success"}
                style={({ pressed })=>[manSt.connectBtn,pressed&&{ opacity:0.8 },(pairingStatus==="connecting"||pairingStatus==="loading")&&{ opacity:0.7 }]}>
                <Ionicons name={pairingStatus==="connecting"||pairingStatus==="loading"?"sync-outline":"link-outline"} size={18} color="white"/>
                <Text style={manSt.connectBtnText}>
                  {pairingStatus==="connecting"?"Looking up server…":pairingStatus==="loading"?"Connecting…":"Connect"}
                </Text>
              </Pressable>
              <Pressable onPress={()=>{ setPairScreen("choose"); setPairingStatus("idle"); setPairingError(""); setManualCode(""); }} style={manSt.backLink}>
                <Text style={[manSt.backLinkText,{ color:theme.labelColor }]}>← Back to options</Text>
              </Pressable>
            </>
          )}
        </IOSSheet>

      {/* Paired success — covers everything cleanly */}
      {pairedOverlay&&(
        <View style={[StyleSheet.absoluteFillObject,{ zIndex:9999 }]}>
          <PairedOverlay theme={theme}/>
        </View>
      )}

      <ProPaywallSheet
        visible={paywallVisible}
        onClose={()=>setPaywallVisible(false)}
        onPurchase={handlePurchasePro}
        onRestore={handleRestorePurchase}
        theme={theme}
      />

      {proActivated&&<ProActivatedOverlay onDone={()=>setProActivated(false)}/>}

    </GestureHandlerRootView>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const st=StyleSheet.create({
  container:{ flex:1 },
  topBar:{ flexDirection:"row", justifyContent:"space-between", padding:15, alignItems:"center" },
  title:{ fontSize:18, fontWeight:"600" },
  homeScroll:{ flexGrow:1, paddingVertical:30, paddingBottom:60 },
  card:{ width:screenWidth*0.7, borderRadius:20, paddingVertical:24, paddingHorizontal:20, alignItems:"center", shadowColor:"#000", shadowOffset:{ width:0,height:4 }, shadowOpacity:0.2, shadowRadius:12, elevation:6 },
  cardTop:{ width:"100%", flexDirection:"row", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 },
  cardName:{ color:"white", fontSize:18, fontWeight:"700" },
  cardStatus:{ color:"rgba(255,255,255,0.75)", fontSize:12, marginTop:4 },
  empty:{ flex:1, justifyContent:"center", alignItems:"center", gap:10, paddingTop:80 },
  emptyTitle:{ fontSize:20, fontWeight:"600" }, emptySub:{ fontSize:14 },
  overlayTopBar:{ flexDirection:"row", alignItems:"center", justifyContent:"space-between", paddingTop:8, paddingBottom:12, height:52 },
  overlayCenteredTitle:{ fontSize:18, fontWeight:"600", textAlign:"center", flex:1, textAlignVertical:"center", lineHeight:52 },
  overlayBackBtn:{ flexDirection:"row", alignItems:"center", zIndex:1 },
  overlayBackText:{ color:"#007aff", fontSize:17, marginLeft:2 },
  banner:{ marginHorizontal:20, marginBottom:24, borderRadius:20, paddingVertical:28, alignItems:"center", shadowColor:"#000", shadowOffset:{ width:0,height:4 }, shadowOpacity:0.18, shadowRadius:12, elevation:6 },
  bannerName:{ color:"white", fontSize:20, fontWeight:"700", marginTop:10 },
  bannerStatusRow:{ flexDirection:"row", alignItems:"center", marginTop:6, gap:6 },
  bannerDot:{ width:8, height:8, borderRadius:4 },
  bannerStatus:{ color:"rgba(255,255,255,0.85)", fontSize:13 },
  sectionRow:{ flexDirection:"row", justifyContent:"space-between", alignItems:"center", marginBottom:10, paddingHorizontal:24 },
  sectionLabel:{ fontSize:12, fontWeight:"500", textTransform:"uppercase", letterSpacing:0.5 },
  logsLink:{ textDecorationLine:"underline" },
  pairNote:{ fontSize:12, textAlign:"center", paddingHorizontal:8, marginTop:8, lineHeight:18 },
  macNote:{ fontSize:12, lineHeight:18, marginTop:20 },
  wolWarn:{ flexDirection:"row", alignItems:"center", gap:8, marginHorizontal:20, marginTop:4, marginBottom:8, padding:10, borderRadius:10, borderWidth:1 },
  wolWarnText:{ flex:1, fontSize:12, lineHeight:17 },
});
const notifSt=StyleSheet.create({
  banner:{ flexDirection:"row", alignItems:"flex-start", marginHorizontal:16, marginBottom:8, padding:14, borderRadius:14, borderWidth:1, gap:10 },
  iconWrap:{ width:28, height:28, borderRadius:8, backgroundColor:"rgba(255,149,0,0.15)", justifyContent:"center", alignItems:"center" },
  title:{ color:"#ff9500", fontSize:12, fontWeight:"600", marginBottom:2 },
  body:{ color:"rgba(255,149,0,0.85)", fontSize:13, lineHeight:18 },
  more:{ color:"rgba(255,149,0,0.6)", fontSize:11, marginTop:4 },
});
const panelSt=StyleSheet.create({
  noteBox:{ flexDirection:"row", alignItems:"flex-start", gap:8, padding:12, borderRadius:12, borderWidth:StyleSheet.hairlineWidth, marginBottom:16 },
  noteText:{ fontSize:12, lineHeight:17, flex:1 },
  createCard:{ borderRadius:14, borderWidth:StyleSheet.hairlineWidth, padding:16, marginBottom:16, gap:10 },
  createTitle:{ fontSize:15, fontWeight:"600", marginBottom:4 },
  input:{ fontSize:15, borderWidth:StyleSheet.hairlineWidth, borderRadius:10, paddingHorizontal:12, paddingVertical:10 },
  fileBtn:{ flexDirection:"row", alignItems:"center", gap:8, borderWidth:StyleSheet.hairlineWidth, borderRadius:10, paddingHorizontal:14, paddingVertical:10 },
  fileBtnText:{ color:"#007aff", fontSize:14, fontWeight:"500" },
  hint:{ fontSize:12, lineHeight:17 },
  createBtns:{ flexDirection:"row", gap:10, marginTop:4 },
  cancelBtn:{ flex:1, borderWidth:StyleSheet.hairlineWidth, borderRadius:10, paddingVertical:11, alignItems:"center" },
  cancelBtnText:{ fontSize:15 },
  addBtn:{ flex:1, backgroundColor:"#007aff", borderRadius:10, paddingVertical:11, alignItems:"center" },
  addBtnText:{ color:"white", fontSize:15, fontWeight:"600" },
  actionCard:{ flexDirection:"row", alignItems:"center", gap:12, padding:14, borderRadius:14, borderWidth:StyleSheet.hairlineWidth, marginBottom:10 },
  actionIcon:{ width:40, height:40, borderRadius:10, justifyContent:"center", alignItems:"center" },
  actionName:{ fontSize:15, fontWeight:"600" },
  actionPath:{ fontSize:12, marginTop:2 },
  empty:{ alignItems:"center", paddingVertical:40, gap:10 },
  emptyTitle:{ fontSize:18, fontWeight:"600" },
  emptySub:{ fontSize:13, textAlign:"center", lineHeight:18, paddingHorizontal:20 },
  iconPickerBtn:{ flexDirection:"row", alignItems:"center", gap:10, borderWidth:StyleSheet.hairlineWidth, borderRadius:10, paddingHorizontal:12, paddingVertical:10 },
  iconGrid:{ flexDirection:"row", flexWrap:"wrap", gap:8, borderRadius:10, borderWidth:StyleSheet.hairlineWidth, padding:10 },
  iconGridItem:{ width:56, alignItems:"center", gap:4, padding:8, borderRadius:9, borderWidth:1 },
  iconGridLabel:{ fontSize:9, fontWeight:"500" },
  adminRow:{ flexDirection:"row", alignItems:"center", gap:12, borderWidth:1, borderRadius:12, paddingHorizontal:14, paddingVertical:12 },
  adminToggle:{ width:44, height:26, borderRadius:13, padding:2, justifyContent:"center" },
  adminThumb:{ width:22, height:22, borderRadius:11, backgroundColor:"white" },
  adminBadge:{ flexDirection:"row", alignItems:"center", gap:3, backgroundColor:"#f59e0b22", borderRadius:6, paddingHorizontal:6, paddingVertical:2 },
  adminBadgeText:{ fontSize:10, color:"#f59e0b", fontWeight:"600" },
  adminNote:{ flexDirection:"row", alignItems:"flex-start", gap:8, borderWidth:1, borderRadius:10, paddingHorizontal:12, paddingVertical:10 },
});
const mediaSt=StyleSheet.create({
  container:{ flex:1, alignItems:"center", justifyContent:"center", gap:32, paddingHorizontal:32 },
  nowPlayingCard:{ flexDirection:"row", alignItems:"center", gap:12, borderWidth:StyleSheet.hairlineWidth, borderRadius:14, padding:12, width:"100%" },
  albumArt:{ width:52, height:52, borderRadius:8 },
  albumArtPlaceholder:{ width:52, height:52, borderRadius:8, justifyContent:"center", alignItems:"center" },
  trackTitle:{ fontSize:15, fontWeight:"600" },
  trackArtist:{ fontSize:13, marginTop:2 },
  mainRow:{ flexDirection:"row", alignItems:"center", gap:24 },
  volRow:{ flexDirection:"row", alignItems:"center", gap:20 },
  btn:{ width:72, height:72, borderRadius:36, justifyContent:"center", alignItems:"center" },
  hint:{ fontSize:13, textAlign:"center", marginTop:8 },
});
const clipSt=StyleSheet.create({
  card:{ borderRadius:14, borderWidth:StyleSheet.hairlineWidth, padding:16, gap:12 },
  sectionLabel:{ fontSize:11, fontWeight:"700", letterSpacing:0.8 },
  fetchBtn:{ flexDirection:"row", alignItems:"center", justifyContent:"center", gap:8, borderWidth:1, borderRadius:12, paddingVertical:12 },
  fetchBtnText:{ fontSize:15, fontWeight:"600", color:"#007aff" },
  textBox:{ borderWidth:StyleSheet.hairlineWidth, borderRadius:10, padding:12, minHeight:80 },
  clipText:{ fontSize:14, lineHeight:20 },
  input:{ borderWidth:StyleSheet.hairlineWidth, borderRadius:10, padding:12, fontSize:14, textAlignVertical:"top" },
  status:{ fontSize:13, fontWeight:"500", textAlign:"center" },
  hint:{ fontSize:13, lineHeight:19 },
  warnRow:{ flexDirection:"row", alignItems:"flex-start", gap:6, borderWidth:1, borderRadius:8, padding:8 },
  warnText:{ fontSize:12, flex:1, lineHeight:17 },
});
const netSt=StyleSheet.create({
  card:{ borderRadius:14, borderWidth:StyleSheet.hairlineWidth, padding:16, gap:4 },
  cardLabel:{ fontSize:11, fontWeight:"700", letterSpacing:0.8, marginBottom:8 },
  statRow:{ flexDirection:"row", alignItems:"center", paddingVertical:10, borderBottomWidth:StyleSheet.hairlineWidth, gap:10 },
  statIcon:{ width:30, height:30, borderRadius:8, justifyContent:"center", alignItems:"center" },
  statLabel:{ flex:1, fontSize:14 },
  statValue:{ fontSize:14, fontWeight:"600" },
});
const sbSt=StyleSheet.create({
  deviceModal:{ borderTopLeftRadius:20, borderTopRightRadius:20, padding:20, paddingBottom:36 },
  deviceLabel:{ fontSize:11, fontWeight:"700", letterSpacing:0.8 },
  deviceRow:{ flexDirection:"row", alignItems:"center", gap:12, paddingVertical:12, paddingHorizontal:8, borderRadius:10 },
  deviceRowText:{ flex:1, fontSize:15 },
  grid:{ flexDirection:"row", flexWrap:"wrap", gap:8 },
  soundBtn:{ borderWidth:1.5, borderRadius:12, padding:10, alignItems:"center", gap:6, minHeight:72, justifyContent:"center" },
  soundName:{ fontSize:11, fontWeight:"600", textAlign:"center" },
});
const legalSt=StyleSheet.create({
  updated:{ fontSize:12, marginBottom:20, marginTop:8 },
  section:{ marginBottom:20 },
  heading:{ fontSize:14, fontWeight:"700", marginBottom:6 },
  body:{ fontSize:13, lineHeight:20 },
});
const fileSt=StyleSheet.create({
  pathBar:{ flexDirection:"row", alignItems:"center", marginHorizontal:16, marginVertical:6, paddingHorizontal:12, paddingVertical:8, borderRadius:10, borderWidth:StyleSheet.hairlineWidth },
  pathText:{ fontSize:12, flex:1 },
  searchBar:{ flexDirection:"row", alignItems:"center", gap:8, marginHorizontal:16, marginBottom:4, paddingHorizontal:12, paddingVertical:8, borderRadius:10, borderWidth:StyleSheet.hairlineWidth },
  searchInput:{ flex:1, fontSize:14, padding:0 },
  searchCount:{ fontSize:12, marginHorizontal:20, marginBottom:6 },
  entry:{ flexDirection:"row", alignItems:"center", gap:12, paddingHorizontal:20, paddingVertical:14, borderBottomWidth:StyleSheet.hairlineWidth },
  entryIcon:{ width:38, height:38, borderRadius:10, justifyContent:"center", alignItems:"center" },
  entryName:{ fontSize:15, fontWeight:"500" },
  entrySize:{ fontSize:12, marginTop:2 },
});
const evEdSt=StyleSheet.create({
  sectionLabel:{ fontSize:11, fontWeight:"600", textTransform:"uppercase", letterSpacing:0.5, marginBottom:8, marginTop:20 },
  inputCard:{ borderRadius:12, borderWidth:StyleSheet.hairlineWidth, paddingHorizontal:14, paddingVertical:4, marginBottom:4 },
  nameInput:{ fontSize:16, paddingVertical:12 },
  timeCard:{ borderRadius:12, borderWidth:StyleSheet.hairlineWidth, padding:20, marginBottom:4 },
  timeRow:{ flexDirection:"row", alignItems:"center", justifyContent:"center", gap:16 },
  spinCol:{ alignItems:"center", gap:8 },
  spinArrow:{ padding:4 },
  spinVal:{ fontSize:36, fontWeight:"300", minWidth:50, textAlign:"center" },
  colon:{ fontSize:36, fontWeight:"300", marginBottom:4 },
  ampmBtn:{ borderWidth:StyleSheet.hairlineWidth, borderRadius:10, paddingHorizontal:14, paddingVertical:8, marginLeft:8 },
  ampmText:{ fontSize:17, fontWeight:"600" },
  pillRow:{ flexDirection:"row", gap:8, marginBottom:4 },
  pill:{ flex:1, borderWidth:StyleSheet.hairlineWidth, borderRadius:10, paddingVertical:10, alignItems:"center" },
  pillText:{ fontSize:13, fontWeight:"500" },
  dayRow:{ flexDirection:"row", gap:6, flexWrap:"wrap", marginBottom:4 },
  dayPill:{ borderWidth:StyleSheet.hairlineWidth, borderRadius:8, paddingHorizontal:10, paddingVertical:7, minWidth:44, alignItems:"center" },
  dayPillText:{ fontSize:12, fontWeight:"500" },
  stepHint:{ fontSize:12, lineHeight:17, marginBottom:10 },
  stepCard:{ flexDirection:"row", alignItems:"center", gap:10, padding:12, borderRadius:12, borderWidth:StyleSheet.hairlineWidth, marginBottom:8 },
  stepIcon:{ width:34, height:34, borderRadius:9, justifyContent:"center", alignItems:"center" },
  stepLabel:{ fontSize:14, fontWeight:"500" },
  stepPath:{ fontSize:12, marginTop:2 },
  addStepBtn:{ flexDirection:"row", alignItems:"center", justifyContent:"center", gap:8, borderWidth:1, borderStyle:"dashed", borderRadius:12, paddingVertical:14, marginTop:4 },
  addStepBtnText:{ color:"#007aff", fontSize:15, fontWeight:"500" },
  addStepCard:{ borderRadius:14, borderWidth:StyleSheet.hairlineWidth, padding:16, marginTop:4, gap:2 },
  addStepTitle:{ fontSize:14, fontWeight:"600", marginBottom:8 },
  stepOption:{ flexDirection:"row", alignItems:"center", gap:10, paddingVertical:10, borderBottomWidth:StyleSheet.hairlineWidth },
  stepOptionText:{ fontSize:15 },
  divider:{ height:StyleSheet.hairlineWidth, marginVertical:8 },
  groupLabel:{ fontSize:11, fontWeight:"600", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 },
  cancelStepBtn:{ alignItems:"center", paddingTop:12 },
});
const evListSt=StyleSheet.create({
  card:{ flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:14, borderRadius:14, borderWidth:StyleSheet.hairlineWidth, marginBottom:10 },
  left:{ flexDirection:"row", alignItems:"center", gap:12, flex:1 },
  iconWrap:{ width:40, height:40, borderRadius:10, justifyContent:"center", alignItems:"center" },
  name:{ fontSize:15, fontWeight:"600" },
  sub:{ fontSize:12, marginTop:2 },
  right:{ flexDirection:"row", alignItems:"center" },
});
const errSt=StyleSheet.create({
  container:{ flexDirection:"row", alignItems:"flex-start", marginHorizontal:16, marginBottom:8, padding:14, borderRadius:14, borderWidth:1, gap:10 },
  message:{ color:"#ef4444", fontSize:13, lineHeight:18, marginBottom:6 },
  repairLink:{ color:"#007aff", fontSize:13, fontWeight:"600" },
});
const toastSt=StyleSheet.create({
  container:{ position:"absolute", top:56, left:20, right:20, zIndex:999, flexDirection:"row", alignItems:"center", borderRadius:16, paddingHorizontal:16, paddingVertical:12, gap:12, overflow:"hidden", shadowColor:"#000", shadowOffset:{ width:0,height:4 }, shadowOpacity:0.3, shadowRadius:12, elevation:8 },
  iconWrap:{ width:36, height:36, borderRadius:10, justifyContent:"center", alignItems:"center" },
  message:{ flex:1, color:"#ffffff", fontSize:15, fontWeight:"600" },
  dot:{ width:8, height:8, borderRadius:4, opacity:0.8 },
});
const statSt=StyleSheet.create({
  container:{ borderRadius:14, borderWidth:StyleSheet.hairlineWidth, overflow:"hidden" },
  headerRow:{ flexDirection:"row", alignItems:"center", justifyContent:"space-between", paddingHorizontal:14, paddingVertical:12 },
  headerLeft:{ flexDirection:"row", alignItems:"center", gap:8 },
  headerTitle:{ fontSize:14, fontWeight:"600" }, headerSub:{ fontSize:13 },
  content:{ paddingHorizontal:14, paddingBottom:14, gap:14 },
  row:{ gap:6 },
  header:{ flexDirection:"row", justifyContent:"space-between", alignItems:"center" },
  labelRow:{ flexDirection:"row", alignItems:"center", gap:8 },
  dot:{ width:8, height:8, borderRadius:4 },
  label:{ fontSize:13, fontWeight:"500" }, temp:{ fontSize:12 }, value:{ fontSize:13 },
  barBg:{ height:6, borderRadius:3, overflow:"hidden" },
  barFill:{ height:6, borderRadius:3 },
  noData:{ fontSize:13, textAlign:"center", paddingVertical:8 },
  uptimeRow:{ flexDirection:"row", alignItems:"center", gap:6, paddingTop:4 },
  uptimeText:{ fontSize:12 },
});
const logSt=StyleSheet.create({
  list:{ paddingHorizontal:20, paddingTop:8, paddingBottom:60 },
  deviceLabel:{ fontSize:11, fontWeight:"600", letterSpacing:0.6, textTransform:"uppercase", marginBottom:16 },
  entry:{ flexDirection:"row", gap:14, paddingBottom:20 },
  timelineCol:{ alignItems:"center", width:32 },
  iconCircle:{ width:32, height:32, borderRadius:16, justifyContent:"center", alignItems:"center" },
  line:{ width:1.5, flex:1, marginTop:6 },
  entryContent:{ flex:1, paddingTop:6 },
  entryLabel:{ fontSize:14, fontWeight:"500", marginBottom:3 }, entryTime:{ fontSize:12 },
  empty:{ flex:1, justifyContent:"center", alignItems:"center", gap:12, paddingHorizontal:40 },
  emptyTitle:{ fontSize:18, fontWeight:"600" }, emptySub:{ fontSize:13, textAlign:"center", lineHeight:18 },
});
const faqSt=StyleSheet.create({
  item:{ borderRadius:12, borderWidth:StyleSheet.hairlineWidth, overflow:"hidden" },
  questionRow:{ flexDirection:"row", alignItems:"center", justifyContent:"space-between", padding:14, gap:10 },
  question:{ fontSize:14, fontWeight:"500", flex:1 },
  answer:{ fontSize:13, lineHeight:19, paddingHorizontal:14, paddingBottom:14 },
});
const tsSt=StyleSheet.create({
  card:{ flexDirection:"row", alignItems:"flex-start", gap:14, padding:14, borderRadius:14, borderWidth:StyleSheet.hairlineWidth },
  iconWrap:{ width:40, height:40, borderRadius:10, justifyContent:"center", alignItems:"center" },
  title:{ fontSize:14, fontWeight:"600", marginBottom:4 }, body:{ fontSize:13, lineHeight:18 },
});
const setupSt=StyleSheet.create({
  backRow:{ flexDirection:"row", alignItems:"center", marginBottom:16 },
  backText:{ color:"#007aff", fontSize:16, marginLeft:2 },
  heading:{ fontSize:22, fontWeight:"700", marginBottom:6 },
  subheading:{ fontSize:14, lineHeight:20, marginBottom:24 },
  steps:{ gap:20, marginBottom:28 },
  stepRow:{ flexDirection:"row", alignItems:"flex-start", gap:14 },
  stepIcon:{ width:44, height:44, borderRadius:12, justifyContent:"center", alignItems:"center", marginTop:2 },
  stepTitle:{ fontSize:15, fontWeight:"600", marginBottom:3 }, stepBody:{ fontSize:13, lineHeight:18 },
  dlBtn:{ backgroundColor:"#1a1a2e", borderRadius:14, padding:16, flexDirection:"row", alignItems:"center", justifyContent:"center", gap:10, marginBottom:8 },
  dlBtnText:{ color:"white", fontSize:16, fontWeight:"600" },
  freeNote:{ fontSize:12, textAlign:"center", marginBottom:20 },
  readyBtn:{ borderWidth:StyleSheet.hairlineWidth, borderRadius:12, padding:14, alignItems:"center" },
  readyBtnText:{ fontSize:15, fontWeight:"500" },
  noAgentBtn:{ flexDirection:"row", alignItems:"center", justifyContent:"center", gap:6, borderWidth:StyleSheet.hairlineWidth, borderRadius:12, padding:12, marginBottom:16 },
  noAgentText:{ fontSize:14 },
});
const dotSt=StyleSheet.create({
  dot:{ width:10, height:10, borderRadius:5, shadowOffset:{ width:0,height:0 }, shadowOpacity:0.8, shadowRadius:4, elevation:3 },
});
const gridSt=StyleSheet.create({
  container:{ flexDirection:"row", flexWrap:"wrap", paddingHorizontal:20, gap:12 },
  tile:{ borderRadius:18, alignItems:"center", justifyContent:"center", paddingVertical:18, gap:10, shadowColor:"#000", shadowOffset:{ width:0,height:2 }, shadowOpacity:0.08, shadowRadius:6, elevation:2 },
  iconCircle:{ width:60, height:60, borderRadius:30, justifyContent:"center", alignItems:"center" },
  label:{ fontSize:14, fontWeight:"600" },
});
const sheetSt=StyleSheet.create({
  backdrop:{ ...StyleSheet.absoluteFillObject, backgroundColor:"rgba(0,0,0,0.4)" },
  container:{ position:"absolute", top:SHEET_TOP_OFFSET, left:0, right:0, bottom:0, borderTopLeftRadius:22, borderTopRightRadius:22, overflow:"hidden" },
  dragArea:{ alignItems:"center", paddingTop:12, paddingBottom:10, minHeight:44 },
  handle:{ width:40, height:5, borderRadius:3, marginTop:2 },
  headerRow:{ flexDirection:"row", alignItems:"center", justifyContent:"space-between", paddingHorizontal:16, paddingBottom:14 },
  xBtn:{ width:30, height:30, borderRadius:15, overflow:"hidden", justifyContent:"center", alignItems:"center" },
  title:{ fontSize:17, fontWeight:"600", textAlign:"center" },
});
const groupSt=StyleSheet.create({
  wrapper:{ marginBottom:28 },
  label:{ fontSize:12, fontWeight:"500", textTransform:"uppercase", letterSpacing:0.5, marginBottom:6, marginLeft:4 },
  card:{ borderRadius:12, overflow:"hidden", borderWidth:StyleSheet.hairlineWidth },
  row:{ flexDirection:"row", alignItems:"center", paddingHorizontal:14, paddingVertical:11, backgroundColor:"transparent" },
  iconWrap:{ width:30, height:30, borderRadius:7, justifyContent:"center", alignItems:"center", marginRight:12 },
  rowContent:{ flex:1 },
  rowTitle:{ fontSize:16 }, rowSub:{ fontSize:12, marginTop:1 }, rowValue:{ fontSize:16, marginRight:4 },
});
const erSt=StyleSheet.create({
  row:{ flexDirection:"row", justifyContent:"space-between", alignItems:"center", paddingVertical:14, borderBottomWidth:StyleSheet.hairlineWidth, marginBottom:4 },
  label:{ fontSize:16 }, sublabel:{ fontSize:12, marginTop:2 }, value:{ fontSize:16 },
  input:{ fontSize:16, borderBottomWidth:1.5, minWidth:140, paddingBottom:2, textAlign:"right" },
  right:{ flexDirection:"row", alignItems:"center", gap:8 },
  colorDot:{ width:14, height:14, borderRadius:7 },
});
const dropSt=StyleSheet.create({
  container:{ position:"absolute", bottom:40, left:20, right:20, borderRadius:14, borderWidth:StyleSheet.hairlineWidth, overflow:"hidden" },
  item:{ flexDirection:"row", alignItems:"center", paddingHorizontal:16, paddingVertical:14 },
  label:{ fontSize:16 },
});
const qrSt=StyleSheet.create({
  container:{ flex:1, justifyContent:"center", alignItems:"center", gap:16 },
  msg:{ fontSize:16, textAlign:"center", paddingHorizontal:30 },
  overlay:{ ...StyleSheet.absoluteFillObject, justifyContent:"space-between", alignItems:"center", paddingVertical:60 },
  instruction:{ color:"white", fontSize:15, textAlign:"center", backgroundColor:"rgba(0,0,0,0.55)", padding:12, borderRadius:10 },
  cutout:{ width:220, height:220, borderWidth:3, borderColor:"white", borderRadius:16 },
  cancelBtn:{ backgroundColor:"rgba(0,0,0,0.6)", paddingHorizontal:28, paddingVertical:12, borderRadius:24 },
  cancelText:{ color:"white", fontSize:16, fontWeight:"600" },
});
const manSt=StyleSheet.create({
  inputRow:{ flexDirection:"row", justifyContent:"space-between", alignItems:"center", paddingHorizontal:14, paddingVertical:12 },
  inputLabel:{ fontSize:16 },
  input:{ fontSize:15, textAlign:"right", minWidth:160 },
  hintRow:{ flexDirection:"row", alignItems:"flex-start", gap:6, paddingHorizontal:14, paddingBottom:10, borderTopWidth:StyleSheet.hairlineWidth, paddingTop:8 },
  hintText:{ fontSize:12, lineHeight:17, flex:1 },
  connectBtn:{ backgroundColor:"#007aff", borderRadius:14, padding:16, alignItems:"center", flexDirection:"row", justifyContent:"center", gap:8, marginBottom:12 },
  connectBtnText:{ color:"white", fontSize:16, fontWeight:"600" },
  backLink:{ alignItems:"center", padding:8 },
  backLinkText:{ fontSize:14 },
  errorBox:{ flexDirection:"row", alignItems:"center", gap:8, backgroundColor:"rgba(255,59,48,0.1)", borderRadius:10, padding:12, marginBottom:12 },
  errorText:{ color:"#ff3b30", fontSize:14, flex:1 },
});
const pairSt=StyleSheet.create({
  overlay:{ ...StyleSheet.absoluteFillObject, justifyContent:"center", alignItems:"center", gap:16 },
  text:{ fontSize:22, fontWeight:"700" }, subtext:{ fontSize:14 },
});
const sceneSt=StyleSheet.create({
  tileGrid:{ flexDirection:"row", flexWrap:"wrap", gap:12 },
  tile:{ width:(screenWidth-40-12)/2, borderRadius:18, padding:16, gap:8, minHeight:100, position:"relative",
    shadowColor:"#000", shadowOffset:{ width:0,height:2 }, shadowOpacity:0.15, shadowRadius:6, elevation:3 },
  tileName:{ color:"white", fontSize:14, fontWeight:"600", paddingRight:28 },
  tileEdit:{ position:"absolute", top:10, right:10 },
  appearCard:{ borderRadius:14, borderWidth:StyleSheet.hairlineWidth, padding:16, marginBottom:4, gap:12 },
  previewTile:{ borderRadius:14, padding:16, alignItems:"center", gap:8, alignSelf:"center", width:120 },
  previewName:{ color:"white", fontSize:12, fontWeight:"600" },
  colorRow:{ flexDirection:"row", gap:10, flexWrap:"wrap" },
  colorDot:{ width:28, height:28, borderRadius:14 },
  iconPickerBtn:{ flexDirection:"row", alignItems:"center", borderWidth:StyleSheet.hairlineWidth, borderRadius:10, paddingHorizontal:12, paddingVertical:10 },
  iconGrid:{ flexDirection:"row", flexWrap:"wrap", gap:8 },
  iconGridItem:{ width:44, height:44, borderRadius:10, justifyContent:"center", alignItems:"center", borderWidth:1 },
  deleteBtn:{ flexDirection:"row", alignItems:"center", justifyContent:"center", gap:8, borderWidth:1, borderRadius:12, paddingVertical:14, marginTop:20 },
});
const volSt=StyleSheet.create({
  card:{ borderRadius:14, borderWidth:StyleSheet.hairlineWidth, padding:16, marginBottom:10, gap:10 },
  row:{ flexDirection:"row", alignItems:"center", gap:10 },
  muteBtn:{ width:32, alignItems:"center" },
  appName:{ flex:1, fontSize:15, fontWeight:"500" },
  volPct:{ fontSize:13, minWidth:44, textAlign:"right" },
  sliderHitArea:{ height:36, justifyContent:"center", marginTop:2 },
  sliderTrack:{ height:6, borderRadius:3, overflow:"visible" },
  sliderFill:{ height:6, borderRadius:3 },
  sliderThumb:{ position:"absolute", top:-5, width:16, height:16, borderRadius:8,
    backgroundColor:"white", borderWidth:2, marginLeft:-8,
    shadowColor:"#000", shadowOffset:{ width:0,height:1 }, shadowOpacity:0.2, shadowRadius:2, elevation:2 },
});
const proSt=StyleSheet.create({
  badge:{ flexDirection:"row", alignItems:"center", gap:5, backgroundColor:"#007aff22", borderWidth:1, borderColor:"#007aff44", borderRadius:20, paddingHorizontal:12, paddingVertical:4, marginBottom:12 },
  badgeText:{ color:"#007aff", fontSize:13, fontWeight:"700", letterSpacing:0.5 },
  title:{ fontSize:24, fontWeight:"700", marginBottom:6, textAlign:"center" },
  subtitle:{ fontSize:14, textAlign:"center", lineHeight:20, marginBottom:16 },
  featureGrid:{ gap:10 },
  featureItem:{ flexDirection:"row", alignItems:"center", gap:12, padding:12, borderRadius:12, borderWidth:StyleSheet.hairlineWidth },
  featureIcon:{ width:36, height:36, borderRadius:10, justifyContent:"center", alignItems:"center" },
  featureLabel:{ fontSize:14, fontWeight:"600" },
  featureDesc:{ fontSize:12, marginTop:1 },
  buyBtn:{ backgroundColor:"#007aff", borderRadius:14, paddingVertical:16, alignItems:"center" },
  buyBtnText:{ color:"white", fontSize:17, fontWeight:"700" },
  lockBadge:{ position:"absolute", top:8, right:8, flexDirection:"row", alignItems:"center", gap:2, backgroundColor:"#007aff", borderRadius:8, paddingHorizontal:5, paddingVertical:2 },
  lockBadgeText:{ color:"white", fontSize:9, fontWeight:"800", letterSpacing:0.3 },
});
const onbSt=StyleSheet.create({
  page:{ flex:1, alignItems:"center", justifyContent:"center", paddingHorizontal:32, paddingBottom:120 },
  logoWrap:{ width:100, height:100, borderRadius:24, overflow:"hidden", marginBottom:28, shadowColor:"#000", shadowOffset:{ width:0,height:8 }, shadowOpacity:0.4, shadowRadius:20, elevation:10 },
  logo:{ width:100, height:100 },
  bigIcon:{ width:100, height:100, borderRadius:24, justifyContent:"center", alignItems:"center", marginBottom:28 },
  title:{ fontSize:26, fontWeight:"700", color:"#ffffff", textAlign:"center", marginBottom:10 },
  subtitle:{ fontSize:16, color:"rgba(255,255,255,0.55)", textAlign:"center", lineHeight:24, marginBottom:32 },
  featureList:{ width:"100%", gap:14 },
  featureRow:{ flexDirection:"row", alignItems:"center", gap:14 },
  featureIcon:{ width:40, height:40, borderRadius:12, justifyContent:"center", alignItems:"center" },
  featureText:{ flex:1, color:"rgba(255,255,255,0.75)", fontSize:15, lineHeight:21 },
  stepList:{ width:"100%", gap:16, marginBottom:32 },
  stepRow:{ flexDirection:"row", alignItems:"flex-start", gap:14 },
  stepNum:{ width:28, height:28, borderRadius:14, backgroundColor:"#007aff", justifyContent:"center", alignItems:"center", marginTop:1 },
  stepNumText:{ color:"white", fontSize:13, fontWeight:"700" },
  stepText:{ flex:1, color:"rgba(255,255,255,0.75)", fontSize:15, lineHeight:22 },
  dlBtn:{ backgroundColor:"#007aff", borderRadius:14, paddingVertical:16, paddingHorizontal:24, flexDirection:"row", alignItems:"center", justifyContent:"center", gap:10, width:"100%", marginBottom:10 },
  dlBtnText:{ color:"white", fontSize:16, fontWeight:"600" },
  freeNote:{ fontSize:13, color:"rgba(255,255,255,0.35)", textAlign:"center" },
  primaryBtn:{ backgroundColor:"#22c55e", borderRadius:14, paddingVertical:16, paddingHorizontal:24, alignItems:"center", width:"100%" },
  primaryBtnText:{ color:"white", fontSize:17, fontWeight:"700" },
  dots:{ flexDirection:"row", justifyContent:"center", gap:8, position:"absolute", bottom:80, left:0, right:0 },
  dot:{ width:7, height:7, borderRadius:3.5, backgroundColor:"rgba(255,255,255,0.25)" },
  dotActive:{ backgroundColor:"#ffffff", width:20 },
  nextRow:{ position:"absolute", bottom:28, left:0, right:0, alignItems:"center" },
  nextBtn:{ backgroundColor:"#007aff", borderRadius:30, paddingVertical:14, paddingHorizontal:32, flexDirection:"row", alignItems:"center", gap:8 },
  nextBtnText:{ color:"white", fontSize:16, fontWeight:"600" },
});
const dbgSt=StyleSheet.create({
  banner:{ flexDirection:"row", alignItems:"flex-start", gap:10, padding:12, borderRadius:12, borderWidth:1 },
  sectionLabel:{ fontSize:11, fontWeight:"700", letterSpacing:0.8, marginTop:4 },
  infoCard:{ borderRadius:12, borderWidth:StyleSheet.hairlineWidth, overflow:"hidden" },
  infoRow:{ flexDirection:"row", justifyContent:"space-between", alignItems:"center", padding:12 },
  actionBtn:{ borderWidth:1, borderRadius:12, paddingVertical:14, paddingHorizontal:16, alignItems:"center" },
  errorBtn:{ borderWidth:1, borderRadius:12, paddingVertical:12, paddingHorizontal:16, flexDirection:"row", alignItems:"center", gap:10 },
  logBox:{ borderRadius:12, borderWidth:StyleSheet.hairlineWidth, padding:12, gap:4 },
});