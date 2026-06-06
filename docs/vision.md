# My Vision of the project ioBroker adapter for FMD

I have a running ioBroker server at home. I want to push a hardware button (Shelly 1PM mini) which pushes a mqtt message to a broker. The mqtt queue is consumed by ioBroker and it therefore changes the ioBroker object which is detected by a running JavaScript. When it got pushed, the JavaScript uses the new adapter for FMD to ring my phone via the ntfy service.

It must also be possible to trigger the "ring" without the Button through ioBroker, e.g. to add a Software Button on a vis-2 Dashboard via JavaScript.

## ioBroker

- How to create a new ioBroker adapter: https://github.com/ioBroker/create-adapter#readme
- My ioBroker runs under zephyr.example.com 192.168.1.28 / 2001:1b54:9002:d001::18 (only accessible via VPN) 
- Button Object "shelly.0.shellyplus1pm#cc7b5c837250#1.Input0.Event"
- Button Action: triple_push
- In the adapter settings you should be able to configure the FMD server endpoint, username & password (which should be stored as secure as possible)

## FMD

On my server I run FMD in a docker container with version 0.14.0

As far as I know there is an advanced login flow to the FMD server to send the "ring" command. It seems that you can only use username&passwort for authentication.

- Source: https://gitlab.com/fmd-foss/fmd-server
- Docs: https://fmd-foss.org/docs/fmd-server
- Client App Doc: https://fmd-foss.org/docs/fmd-android/push
- My FMD server runs under https://fmd.example.com

## Project

- Use /Users/tschnurre/external-GIT/ioBroker-fmd-adapter as git repo (is already initialized)
- This should become a public repository, so always make comments and docs, why you change something or why the architecture design is as it is
- Never commit and push automatically, only when users tells you to
- Maybe this python project helps you to understand FMD: https://github.com/devinslick/fmd_api
- In the README.md it should be mentioned: Purpose of this project, how to


