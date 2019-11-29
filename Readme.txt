This is a portable application intended to be run on a USB drive to ease media file management.
This program is not intended for external use though you are welcome to learn from/hack it.
Below is the filesystem layout that I use:
-------------------------------------------
[e:\]
 \bin
 \.1
 \.2
 .
 .
 .
 \.52
 [shortcut to ems binary]
-------------------------------------------
Each folder contains a few songs. The program automatically selects the correct folder from the current date.
If you want to change what folders the app checks for media files edit the getMediaFilesFolder(), getPlaylistByWeek() and getPlaylistByEvent() functions
-------------------------------------------
To test/devel:
npm install
npm start .
-------------------------------------------
To package for win ia32:
electron-packager -p --overwrite . ems --platform=win32 --arch=ia32
-------------------------------------------
Deploy by copying the files in the ems-win32-ia32 folder to bin folder on the flash drive.
Then create a shortcut to ems.exe and place it in the drive root.
