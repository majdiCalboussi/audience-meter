package
{
    import flash.display.LoaderInfo;
    import flash.display.Sprite;
    import flash.external.ExternalInterface;
    import flash.net.URLStream;
    import flash.events.Event;
    import flash.events.ProgressEvent;
    import flash.events.IOErrorEvent;
    import flash.net.URLRequest;
    import flash.net.URLRequestHeader;
    import flash.net.URLRequestMethod;
    import flash.utils.setTimeout;

    public dynamic class Audience extends Sprite
    {
        private var offset:Number;
        private var stream:URLStream;
        private var callback:String;
        private var request:URLRequest;
        private var retryDelay:Number;

        public function Audience():void
        {
            var params:Object = LoaderInfo(this.root.loaderInfo).parameters;
            var url:String = String(params['url']);
            this.callback = String(params['callback']);

            this.request = new URLRequest(url);
            this.request.method = URLRequestMethod.POST;
            this.request.requestHeaders = new Array(new URLRequestHeader('Accept','text/event-stream'));
            this.request.data = 0;

            this.stream = new URLStream();
            this.stream.addEventListener(ProgressEvent.PROGRESS, this.dataReceived);
            this.stream.addEventListener(Event.COMPLETE, this.reconnect);
            this.stream.addEventListener(IOErrorEvent.IO_ERROR, this.reconnect);

            this.connect();
        }

        private function connect():void
        {
            this.offset = 0;
            this.stream.load(this.request);
        }

        private function reconnect(e:Event):void
        {
            if (retryDelay >= 0)
            {
                setTimeout(this.connect, retryDelay);
            }
        }

        public function dataReceived(e:ProgressEvent):void
        {
            var buffer:String = stream.readUTFBytes(e.bytesLoaded - this.offset);
            this.offset = e.bytesLoaded;
            if (!buffer) return;

            var lines:Array = buffer.split('\n');
            for (var i:int = 0, l:int = lines.length; i < l; i++)
            {
                var info:Array = lines[i].split(/:/, 2),
                    value:Number = parseInt(info[1], 10);
                switch (info[0])
                {
                    case 'data':
                        ExternalInterface.call(this.callback, value);
                        break;
                    case 'retry':
                        this.retryDelay = value;
                        break;
                }
            }
        }
    }
}