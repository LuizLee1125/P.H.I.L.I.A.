declare module "sound-play" {
  export function play(filePath: string, volume?: number): Promise<void>;
  const soundPlay: {
    play: (filePath: string, volume?: number) => Promise<void>;
  };
  export default soundPlay;
}
