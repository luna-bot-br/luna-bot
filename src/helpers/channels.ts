import {
  DiscordGatewayAdapterCreator,
  joinVoiceChannel,
  VoiceConnection,
} from '@discordjs/voice'
import { IVoiceConnectionObject } from 'src/interactionCommands/play.interaction'

export interface IChannels {
  channels: { [key: string]: VoiceConnection }
  getChannel: (id: string) => VoiceConnection
  setChannel: (interaction: IVoiceConnectionObject) => Promise<VoiceConnection>
  removeChannel: (id: string) => void
}

class Channels implements IChannels {
  channels: { [key: string]: VoiceConnection }

  constructor() {
    this.channels = {}
  }

  getChannel(serverId: string) {
    return this.channels[serverId]
  }

  async setChannel(interaction: IVoiceConnectionObject) {
    this.channels[interaction.guildId as string] = joinVoiceChannel({
      channelId: interaction.voiceChannelId as string,
      guildId: interaction.guildId as string,
      adapterCreator:
        interaction.voiceAdapterCreator as DiscordGatewayAdapterCreator,
    })

    return this.channels[interaction.guildId as string]
  }

  removeChannel(serverId: string) {
    this.channels[serverId]?.destroy()

    delete this.channels[serverId]
  }
}

export default new Channels()
