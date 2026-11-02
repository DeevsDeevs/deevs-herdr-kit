// Every setting is optional; these are the defaults.
export const SETTINGS = {
  // Machines to look on: null means this computer and every machine Herdr
  // is connected to. Or a list of names, with null for this computer:
  // [null, "seine-river"].
  machines: null,
  // How often each machine is asked for its sessions.
  scanEveryMs: 4000,
  // Frames per second for the cards and for an open session.
  cardFps: 1,
  viewerFps: 15,
  // A machine added with --via, or one whose ssh needs more than
  // `ssh <target>`: how to ssh there, per machine name.
  //   ssh: { "build-box": { args: ["-p", "2222"], target: "me@10.0.0.7" } }
  ssh: {},
  sshBinary: "ssh",
};
