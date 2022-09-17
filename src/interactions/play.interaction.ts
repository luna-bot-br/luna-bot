import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
  StreamType,
  VoiceConnection,
} from '@discordjs/voice'
import {
  ChannelType,
  ChatInputCommandInteraction,
  InternalDiscordGatewayAdapterCreator,
} from 'discord.js'
import { getBasicInfo, videoInfo } from 'ytdl-core'
import ytdl from 'ytdl-core-discord'
import youtube from 'youtube-sr'
import Channels, { IChannels } from '@src/helpers/channels'
import MusicQueue, { IMusicQueue } from '@src/helpers/musicQueue'
import Players, { IPlayers } from '@src/helpers/players'
import loggerProvider from '@src/providers/loggerProvider'
import { IInteraction } from '@src/interactions/IInteraction'

export type IPlayInteraction = IInteraction

export interface IVoiceConnectionObject {
  voiceChannelId: string | undefined
  guildId: string | undefined
  voiceAdapterCreator: InternalDiscordGatewayAdapterCreator | undefined
}

class PlayInteraction implements IPlayInteraction {
  channel: VoiceConnection | undefined
  musicUrl: string | undefined
  musicsPlaylist: { url: string }[] = []

  constructor(
    private channels: IChannels,
    private musicQueue: IMusicQueue,
    private players: IPlayers
  ) {}

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const voiceConnectionObject = {} as IVoiceConnectionObject

    // @ts-ignore
    const voiceChannelId = interaction.member?.voice.channelId as string
    const serverId = interaction.guildId as string
    const voiceAdapterCreator = interaction.guild?.voiceAdapterCreator

    voiceConnectionObject.voiceChannelId = voiceChannelId
    voiceConnectionObject.guildId = serverId
    voiceConnectionObject.voiceAdapterCreator = voiceAdapterCreator

    const musicOrTermString = interaction.options.getString('music') as string

    const isPlaylist = await this.handlePlaylist(musicOrTermString)

    if (!isPlaylist) {
      await this.getUrl()
    }

    const currentChannel = getVoiceConnection(interaction.guildId as string)

    const musicInfo = await getBasicInfo(this.musicUrl as string)

    if (
      !this.musicQueue.isCurrentPlaying(serverId) &&
      interaction.isRepliable()
    ) {
      interaction
        .reply({
          content: `Playing ${musicInfo.videoDetails.title}`,
        })
        .catch((err) =>
          loggerProvider.log({
            type: 'error',
            message: err,
          })
        )
    } else if (interaction.isRepliable()) {
      interaction
        .reply({
          content: `Added ${musicInfo.videoDetails.title} to playlist`,
        })
        .catch((err) =>
          loggerProvider.log({
            type: 'error',
            message: err,
          })
        )
    }

    if (!voiceChannelId) {
      await this.handleUserWithoutVoiceChannel({
        interaction,
        voiceConnectionObject,
        musicInfo,
        serverId,
        currentChannel,
      })
    }

    if (
      currentChannel?.joinConfig.channelId !== voiceChannelId &&
      voiceChannelId &&
      currentChannel?.joinConfig.channelId
    ) {
      await this.handleUserInDifferentVoiceChannel({
        serverId,
        voiceConnectionObject,
      })
    }

    await this.getChannel(voiceConnectionObject)

    const musicStream = await ytdl(this.musicUrl as string, {
      highWaterMark: 1 << 25,
    })

    const audioResource = createAudioResource(musicStream, {
      metadata: {
        title: musicInfo.videoDetails.title,
        thumbnail: musicInfo.videoDetails.thumbnails[0].url,
      },
      inputType: StreamType.Opus,
    })

    if (this.musicQueue.isCurrentPlaying(serverId)) {
      this.musicQueue.addSong(serverId, audioResource)

      return
    }

    this.musicQueue.addSong(serverId, audioResource)

    const player = createAudioPlayer()

    this.channel?.subscribe(player)

    player.play(audioResource)

    player.on(AudioPlayerStatus.Idle, () => {
      this.musicQueue.removeSong(serverId)

      if (!this.musicQueue.getQueue(serverId).length) return

      const nextSong = this.musicQueue.queue[serverId][0]

      player.play(nextSong)
    })

    this.players.setPlayer(serverId, player)

    this.addPlaylistToQueue(serverId)
  }

  private async addPlaylistToQueue(serverId: string) {
    Promise.all(
      this.musicsPlaylist.map(async (video) => {
        const uniqueMusicInfo = await getBasicInfo(video.url as string)

        const uniqueMusicStream = await ytdl(video.url as string, {
          highWaterMark: 1 << 25,
        })

        const uniqueMusicResource = createAudioResource(uniqueMusicStream, {
          metadata: {
            title: uniqueMusicInfo.videoDetails.title,
            thumbnail: uniqueMusicInfo.videoDetails.thumbnails[0].url,
          },
          inputType: StreamType.Opus,
        })

        this.musicQueue.addSong(serverId, uniqueMusicResource)
      })
    )
  }

  private async handlePlaylist(urlOrTerm: string) {
    const isPlaylist = youtube.isPlaylist(urlOrTerm as string)

    if (!isPlaylist) {
      this.musicUrl = urlOrTerm

      return false
    }

    const musics = await youtube.getPlaylist(urlOrTerm as string)

    this.musicUrl = musics.videos[0].url

    musics.videos.shift()

    this.musicsPlaylist = musics.videos

    return true
  }

  private async getUrl() {
    const isUrl = ytdl.validateURL(this.musicUrl as string)

    if (isUrl) return

    const response = await youtube.searchOne(this.musicUrl as string)

    this.musicUrl = response.url

    return
  }

  private async getChannel(voiceConnectionObject: IVoiceConnectionObject) {
    const serverId = voiceConnectionObject.guildId as string

    const channel = this.channels.getChannel(serverId)

    if (channel) {
      this.channel = channel

      return
    }

    this.channel = await this.channels.setChannel(voiceConnectionObject)

    return
  }

  private async handleUserInDifferentVoiceChannel({
    serverId,
    voiceConnectionObject,
  }: {
    serverId: string
    voiceConnectionObject: IVoiceConnectionObject
  }) {
    if (!this.musicQueue.isCurrentPlaying(serverId)) {
      this.channels.getChannel(serverId)?.destroy()

      this.channel = await this.channels.setChannel(voiceConnectionObject)
    }
  }

  private async handleUserWithoutVoiceChannel({
    interaction,
    voiceConnectionObject,
    musicInfo,
    serverId,
    currentChannel,
  }: {
    interaction: ChatInputCommandInteraction
    voiceConnectionObject: IVoiceConnectionObject
    musicInfo: videoInfo
    serverId: string
    currentChannel: VoiceConnection | undefined
  }) {
    const voiceChannels = interaction.guild?.channels.cache.filter(
      (channel) => {
        return channel.type === ChannelType.GuildVoice
      }
    )

    if (voiceChannels?.size === 1) {
      const firstVoiceChannel = voiceChannels.first()

      voiceConnectionObject.voiceChannelId = firstVoiceChannel?.id || ''
      voiceConnectionObject.voiceAdapterCreator =
        firstVoiceChannel?.guild.voiceAdapterCreator

      if (!currentChannel) {
        await interaction.reply({
          content: `Playing ${musicInfo.videoDetails.title} on ${firstVoiceChannel?.name}. I'm waiting for you!`,
        })

        return
      }

      if (!this.musicQueue.isCurrentPlaying(serverId)) {
        await interaction.reply({
          content: `Playing ${musicInfo.videoDetails.title} on ${firstVoiceChannel?.name}. I'm waiting for you!`,
        })

        return
      }

      await interaction.reply({
        content:
          "Come with me to the voice channel. We'\re listening music over there!",
      })

      return
    }

    if (this.musicQueue.isCurrentPlaying(serverId)) {
      const voiceChannelFound = voiceChannels?.find((channel) => {
        return channel.id === currentChannel?.joinConfig.channelId
      })

      await interaction.reply({
        content: `Come with me to the voice channel ${voiceChannelFound?.name}. We're listening music over there! 🎶`,
      })

      return
    }

    await interaction.reply({
      content: 'What channel are we go? You can enter it and then call me, ok?',
    })

    return
  }
}

export default new PlayInteraction(Channels, MusicQueue, Players)