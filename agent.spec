# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for PCLink Agent
# Run: pyinstaller agent.spec

from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

# Collect ALL winsdk files including .pyd DLLs
winsdk_datas, winsdk_binaries, winsdk_hiddenimports = collect_all('winsdk')

a = Analysis(
    ['agent.py'],
    pathex=[],
    binaries=winsdk_binaries,
    datas=winsdk_datas + [
        ('icon.ico', '.'),    # Bundle icon for tray use at runtime
    ],
    hiddenimports=winsdk_hiddenimports + [
        # websockets
        'websockets',
        'websockets.legacy',
        'websockets.legacy.client',
        'websockets.legacy.server',
        # pycaw / COM
        'pycaw',
        'pycaw.pycaw',
        'comtypes',
        'comtypes.client',
        'comtypes.automation',
        'comtypes.persist',
        'pythoncom',
        'win32com',
        'win32com.client',
        # pystray
        'pystray',
        'pystray._win32',
        # PIL / Pillow
        'PIL',
        'PIL.Image',
        'PIL.ImageTk',
        'PIL.ImageDraw',
        'PIL.ImageGrab',
        # qrcode
        'qrcode',
        'qrcode.image.pil',
        # psutil
        'psutil',
        # GPUtil
        'GPUtil',
        # winreg / win32
        'winreg',
        'win32api',
        'win32con',
        # pygame (soundboard)
        'pygame',
        'pygame.mixer',
        # winsdk (now playing / media controls) — include ALL submodules
        'winsdk',
        'winsdk.windows',
        'winsdk.windows.media',
        'winsdk.windows.media.control',
        'winsdk.windows.media.playback',
        'winsdk.windows.foundation',
        'winsdk.windows.foundation.collections',
        'winsdk.windows.storage',
        'winsdk.windows.storage.streams',
        'winsdk.windows.system',
        'winsdk._winrt',
        # tkinter
        'tkinter',
        'tkinter.filedialog',
        'tkinter.font',
        # speedtest
        'speedtest',
    ],
    excludes=[
        'matplotlib',
        'numpy',
        'pandas',
        'scipy',
        'PyQt5',
        'PyQt6',
        'PySide2',
        'PySide6',
        'wx',
        'gi',
        'gtk',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='PCLink Agent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icon.ico',
    uac_admin=False,
    version='version_info.txt',
)
