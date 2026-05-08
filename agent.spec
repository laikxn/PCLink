# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for PCLink Agent
# Run: pyinstaller agent.spec

block_cipher = None

a = Analysis(
    ['agent.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('icon.ico', '.'),
    ],
    hiddenimports=[
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
