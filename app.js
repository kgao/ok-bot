var restify = require('restify');
var builder = require('botbuilder');
var conf = require('./config');
//=========================================================
// Bot Setup
//=========================================================

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});
  
// Create chat bot
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID || conf.microsoft.app.id,
    appPassword: process.env.MICROSOFT_APP_PASSWORD || conf.microsoft.app.password
});
var bot = new builder.UniversalBot(connector);
server.post('/api/messages', connector.listen());

//=========================================================
// Bots Dialogs
//=========================================================

/*---------------------------------------------------------
hello world 
---------------------------------------------------------*/
// bot.dialog('/', function (session) {
//     session.send("Hello from Azure!");
// });


/*---------------------------------------------------------
waterfall
---------------------------------------------------------*/
// bot.dialog('/', [
//     function (session) {
//         builder.Prompts.text(session, "Hello... What's your name?");
//     },
//     function (session, results) {
//         session.userData.name = results.response;
//         builder.Prompts.number(session, "Hi " + results.response + ", How many years have you been coding?"); 
//     },
//     function (session, results) {
//         session.userData.coding = results.response;
//         builder.Prompts.choice(session, "What language do you code Node using?", ["JavaScript", "CoffeeScript", "TypeScript"]);
//     },
//     function (session, results) {
//         session.userData.language = results.response.entity;
//         session.send("Got it... " + session.userData.name + 
//                      " you've been programming for " + session.userData.coding + 
//                      " years and use " + session.userData.language + ".");
//     }
// ]);


/*----------------------------------------------------------------------------- 
naturalLanguage: NLP via MS LUIS

This Bot demonstrates how to use an IntentDialog with a LuisRecognizer to add 
natural language support to a bot. The example also shows how to use 
UniversalBot.send() to push notifications to a user.

For a complete walkthrough of creating this bot see the article below.

http://docs.botframework.com/builder/node/guides/understanding-natural-language/
-----------------------------------------------------------------------------*/

// Create LUIS recognizer that points at our model and add it as the root '/' dialog for our Cortana Bot.
var model_alarm = process.env.model || 'https://api.projectoxford.ai/luis/v1/application?id=c413b2ef-382c-45bd-8ff0-f76d60e2a821&subscription-key=6d0966209c6e4f6b835ce34492f3e6d9&q=';
var recognizer_alarm = new builder.LuisRecognizer(model_alarm);
var dialogNLP_alarm = new builder.IntentDialog({ recognizers: [recognizer_alarm] });
//bot.dialog('/', dialogNLP);

// // Add intent handlers
dialogNLP_alarm.matches('builtin.intent.alarm.set_alarm', [
    function (session, args, next) {
        // Resolve and store any entities passed from LUIS.
        var title = builder.EntityRecognizer.findEntity(args.entities, 'builtin.alarm.title');
        var time = builder.EntityRecognizer.resolveTime(args.entities);
        var alarm = session.dialogData.alarm = {
          title: title ? title.entity : null,
          timestamp: time ? time.getTime() : null  
        };
        
        // Prompt for title
        if (!alarm.title) {
            builder.Prompts.text(session, 'What would you like to call your alarm?');
        } else {
            next();
        }
    },
    function (session, results, next) {
        var alarm = session.dialogData.alarm;
        if (results.response) {
            alarm.title = results.response;
        }

        // Prompt for time (title will be blank if the user said cancel)
        if (alarm.title && !alarm.timestamp) {
            builder.Prompts.time(session, 'What time would you like to set the alarm for?');
        } else {
            next();
        }
    },
    function (session, results) {
        var alarm = session.dialogData.alarm;
        if (results.response) {
            var time = builder.EntityRecognizer.resolveTime([results.response]);
            alarm.timestamp = time ? time.getTime() : null;
        }
        
        // Set the alarm (if title or timestamp is blank the user said cancel)
        if (alarm.title && alarm.timestamp) {
            // Save address of who to notify and write to scheduler.
            alarm.address = session.message.address;
            alarms[alarm.title] = alarm;
            
            // Send confirmation to user
            var date = new Date(alarm.timestamp);
            var isAM = date.getHours() < 12;
            session.send('Creating alarm named "%s" for %d/%d/%d %d:%02d%s',
                alarm.title,
                date.getMonth() + 1, date.getDate(), date.getFullYear(),
                isAM ? date.getHours() : date.getHours() - 12, date.getMinutes(), isAM ? 'am' : 'pm');
        } else {
            session.send('Ok... no problem.');
        }
    }
]);

dialogNLP_alarm.matches('builtin.intent.alarm.delete_alarm', [
    function (session, args, next) {
        // Resolve entities passed from LUIS.
        var title;
        var entity = builder.EntityRecognizer.findEntity(args.entities, 'builtin.alarm.title');
        if (entity) {
            // Verify its in our set of alarms.
            title = builder.EntityRecognizer.findBestMatch(alarms, entity.entity);
        }
        
        // Prompt for alarm name
        if (!title) {
            builder.Prompts.choice(session, 'Which alarm would you like to delete?', alarms);
        } else {
            next({ response: title });
        }
    },
    function (session, results) {
        // If response is null the user canceled the task
        if (results.response) {
            delete alarms[results.response.entity];
            session.send("Deleted the '%s' alarm.", results.response.entity);
        } else {
            session.send('Ok... no problem.');
        }
    }
]);

dialogNLP_alarm.onDefault(builder.DialogAction.send("I'm sorry I didn't understand. I can only create & delete alarms."));

// Very simple alarm scheduler
var alarms = {};
setInterval(function () {
    var now = new Date().getTime();
    for (var key in alarms) {
        var alarm = alarms[key];
        if (now >= alarm.timestamp) {
            var msg = new builder.Message()
                .address(alarm.address)
                .text("Here's your '%s' alarm.", alarm.title);
            bot.send(msg);
            delete alarms[key];
        }
    }
}, 15000);



/*-----------------------------------------------------------------------------
multiTurn

This Bot demonstrates how to implement simple multi-turns using waterfalls. By
multi-turn we mean supporting scenarios where a user asks a question about 
something and then wants to ask a series of follow-up questions. To support this
the bot needs to track the current context or topic of the conversation. This
sample shows a simple way to use session.dialogState to do just that.

In this specific sample we're using a IntentDialog with a LuisRecognizer to to give 
the bot a more natural language interface but there's nothing specific about 
multi-turn that requires the use of LUIS.

The basic idea is that before we can answer a question we need to know the company 
to answer the question for. This is the “context” of the question. We’re using a 
LUIS model to identify the question the user would like asked and so for every 
intent handler we have the same two basic steps which we’re representing using a 
waterfall. 
-----------------------------------------------------------------------------*/

var model_company = process.env.model || 'https://api.projectoxford.ai/luis/v1/application?id=56c73d36-e6de-441f-b2c2-6ba7ea73a1bf&subscription-key=6d0966209c6e4f6b835ce34492f3e6d9&q=';
var recognizer_company = new builder.LuisRecognizer(model_company);
var dialogNLP_company = new builder.IntentDialog({ recognizers: [recognizer_company ] });
// bot.dialog('/', dialogNLP_company);

var prompts = require('./prompts');

/** Answer help related questions like "what can I say?" */
dialogNLP_company.matches('Help', builder.DialogAction.send(prompts.helpMessage));
dialogNLP_company.onDefault(builder.DialogAction.send(prompts.helpMessage));

/** Answer acquisition related questions like "how many companies has microsoft bought?" */
dialogNLP_company.matches('Acquisitions', [askCompany, answerQuestion('acquisitions', prompts.answerAcquisitions)]);

/** Answer IPO date related questions like "when did microsoft go public?" */
dialogNLP_company.matches('IpoDate', [askCompany, answerQuestion('ipoDate', prompts.answerIpoDate)]);

/** Answer headquarters related questions like "where is microsoft located?" */
dialogNLP_company.matches('Headquarters', [askCompany, answerQuestion('headquarters', prompts.answerHeadquarters)]);

/** Answer description related questions like "tell me about microsoft" */
dialogNLP_company.matches('Description', [askCompany, answerQuestion('description', prompts.answerDescription)]);

/** Answer founder related questions like "who started microsoft?" */
dialogNLP_company.matches('Founders', [askCompany, answerQuestion('founders', prompts.answerFounders)]);

/** Answer website related questions like "how can I contact microsoft?" */
dialogNLP_company.matches('website', [askCompany, answerQuestion('website', prompts.answerWebsite)]);

/** 
 * This function the first step in the waterfall for intent handlers. It will use the company mentioned
 * in the users question if specified and valid. Otherwise it will use the last company a user asked 
 * about. If it the company is missing it will prompt the user to pick one. 
 */
function askCompany(session, args, next) {
    // First check to see if we either got a company from LUIS or have a an existing company
    // that we can multi-turn over.
    var company;
    var entity = builder.EntityRecognizer.findEntity(args.entities, 'CompanyName');
    if (entity) {
        // The user specified a company so lets look it up to make sure its valid.
        // * This calls the underlying function Prompts.choice() uses to match a users response
        //   to a list of choices. When you pass it an object it will use the field names as the
        //   list of choices to match against. 
        company = builder.EntityRecognizer.findBestMatch(data, entity.entity);
    } else if (session.dialogData.company) {
        // Just multi-turn over the existing company
        company = session.dialogData.company;
    }
    
    // Prompt the user to pick a ocmpany if they didn't specify a valid one.
    if (!company) {
        // Lets see if the user just asked for a company we don't know about.
        var txt = entity ? session.gettext(prompts.companyUnknown, { company: entity.entity }) : prompts.companyMissing;
        
        // Prompt the user to pick a company from the list. They can also ask to cancel the operation.
        builder.Prompts.choice(session, txt, data);
    } else {
        // Great! pass the company to the next step in the waterfall which will answer the question.
        // * This will match the format of the response returned from Prompts.choice().
        next({ response: company })
    }
}

/**
 * This function generates a generic answer step for an intent handlers waterfall. The company to answer
 * a question about will be passed into the step and the specified field from the data will be returned to 
 * the user using the specified answer template. 
 */
function answerQuestion(field, answerTemplate) {
    return function (session, results) {
        // Check to see if we have a company. The user can cancel picking a company so IPromptResult.response
        // can be null. 
        if (results.response) {
            // Save company for multi-turn case and compose answer            
            var company = session.dialogData.company = results.response;
            var answer = { company: company.entity, value: data[company.entity][field] };
            session.send(answerTemplate, answer);
        } else {
            session.send(prompts.cancel);
        }
    };
}


/** 
 * Sample data sourced from http://crunchbase.com on 3/18/2016 
 */
var data = {
  'Microsoft': {
      acquisitions: 170,
      ipoDate: 'Mar 13, 1986',
      headquarters: 'Redmond, WA',
      description: 'Microsoft, a software corporation, develops licensed and support products and services ranging from personal use to enterprise application.',
      founders: 'Bill Gates and Paul Allen',
      website: 'http://www.microsoft.com'
  },
  'Apple': {
      acquisitions: 72,
      ipoDate: 'Dec 19, 1980',
      headquarters: 'Cupertino, CA',
      description: 'Apple is a multinational corporation that designs, manufactures, and markets consumer electronics, personal computers, and software.',
      founders: 'Kevin Harvey, Steve Wozniak, Steve Jobs, and Ron Wayne',
      website: 'http://www.apple.com'
  },
  'Google': {
      acquisitions: 39,
      ipoDate: 'Aug 19, 2004',
      headquarters: 'Mountain View, CA',
      description: 'Google is a multinational corporation that is specialized in internet-related services and products.',
      founders: 'Baris Gultekin, Michoel Ogince, Sergey Brin, and Larry Page',
      website: 'http://www.google.com'
  },
  'Amazon': {
      acquisitions: 58,
      ipoDate: 'May 15, 1997',
      headquarters: 'Seattle, WA',
      description: 'Amazon.com is an international e-commerce website for consumers, sellers, and content creators.',
      founders: 'Sachin Agarwal and Jeff Bezos',
      website: 'http://amazon.com'
  }
};



/*-----------------------------------------------------------------------------
first turn

This Bot demonstrates how to create a First Run experience using a piece of
middleware. 

The middleware function will be run for every incoming message and its simply
using a flag persisted off userData to know if the user been sent to the 
/firstRun dialog. The first run experience can be as simple or as complex as
you'd like. In our example we're prompting the user for their name but if you
just wanted to show a simple message you could have called session.send() 
instead of session.beginDialog().

-----------------------------------------------------------------------------*/
// bot.dialog('/', function (session) {
//     session.send("%s, I heard: %s", session.userData.name, session.message.text);
//     session.send("Say something else...");
// });

// // Install First Run middleware and dialog
// bot.use(builder.Middleware.firstRun({ version: 1.0, dialogId: '*:/firstRun' }));
// bot.dialog('/firstRun', [
//     function (session) {
//         builder.Prompts.text(session, "Hello... What's your name?");
//     },
//     function (session, results) {
//         // We'll save the users name and send them an initial greeting. All 
//         // future messages from the user will be routed to the root dialog.
//         session.userData.name = results.response;
//         session.endDialog("Hi %s, say something to me and I'll echo it back.", session.userData.name); 
//     }
// ]);


/*-----------------------------------------------------------------------------
log

This example demonstrates how to add logging/filtering of incoming messages 
using a piece of middleware. Users can turn logging on and off individually by 
sending a "/log on" or "/log off" message.

# RUN THE BOT:

    Run the bot from the command line using "node app.js" and then type 
    "hello" to wake the bot up.

-----------------------------------------------------------------------------*/
// bot.dialog('/', function (session) {
//     session.send("Tell me about it...");
// });

// Install logging middleware
// bot.use({
//     botbuilder: function (session, next) {
//         if (/^\/log on/i.test(session.message.text)) {
//             session.userData.isLogging = true;
//             session.send('Logging is now turned on');
//         } else if (/^\/log off/i.test(session.message.text)) {
//             session.userData.isLogging = false;
//             session.send('Logging is now turned off');
//         } else {
//             if (session.userData.isLogging) {
//                 console.log('Message Received: ', session.message.text);
//             }
//             next();
//         }
//     }
// });


/*-----------------------------------------------------------------------------
validate prompt

This Bot demonstrates how to create a custom prompt that validates a users 
input.
-----------------------------------------------------------------------------*/
// bot.dialog('/', [
//     function (session) {
//         // call custom prompt
//         session.beginDialog('/meaningOfLife', { 
//             prompt: "What's the meaning of life?", 
//             retryPrompt: "Sorry that's incorrect. Guess again." 
//         });
//     },
//     function (session, results) {
//         // Check their answer
//         if (results.response) {
//             session.send("That's correct! The meaning of life is 42.");
//         } else {
//             session.send("Sorry you couldn't figure it out. Everyone knows that the meaning of life is 42.");
//         }
//     }
// ]);

// bot.dialog('/meaningOfLife', builder.DialogAction.validatedPrompt(builder.PromptType.text, function (response) {
//     return response === '42';
// }));



//=========================================================
// MSR Slack BOT (skype original) Activity Events
//=========================================================

bot.on('conversationUpdate', function (message) {
   // Check for group conversations
    if (message.address.conversation.isGroup) {
        // Send a hello message when bot is added
        if (message.membersAdded) {
            message.membersAdded.forEach(function (identity) {
                if (identity.id === message.address.bot.id) {
                    var reply = new builder.Message()
                            .address(message.address)
                            .text("Hello everyone!");
                    bot.send(reply);
                }
            });
        }

        // Send a goodbye message when bot is removed
        if (message.membersRemoved) {
            message.membersRemoved.forEach(function (identity) {
                if (identity.id === message.address.bot.id) {
                    var reply = new builder.Message()
                        .address(message.address)
                        .text("Goodbye");
                    bot.send(reply);
                }
            });
        }
    }
});

bot.on('contactRelationUpdate', function (message) {
    if (message.action === 'add') {
        var name = message.user ? message.user.name : null;
        var reply = new builder.Message()
                .address(message.address)
                .text("Hello %s... Thanks for adding me. Say 'hello' to see some great demos.", name || 'there');
        bot.send(reply);
    } else {
        // delete their data
    }
});

bot.on('deleteUserData', function (message) {
    // User asked to delete their data
});


//=========================================================
// Bots Middleware
//=========================================================

// Anytime the major version is incremented any existing conversations will be restarted.
bot.use(builder.Middleware.dialogVersion({ version: 1.0, resetCommand: /^reset/i }));

//=========================================================
// Bots Global Actions
//=========================================================

bot.endConversationAction('goodbye', 'Goodbye :)', { matches: /^goodbye/i });
bot.endConversationAction('bye', 'Bye :)', { matches: /^bye/i });


bot.beginDialogAction('help', '/help', { matches: /^help/i });
bot.beginDialogAction('menu', '/menu', { matches: /^menu/i }); 
//=========================================================
// Bots Dialogs
//=========================================================

bot.dialog('/', [
    function (session) {
        session.send("Hi from Azure! (Type `menu` to see more options.)");
    },
    // function (session, results) {
    //     // Display menu
    //     session.beginDialog('/menu');
    // },
    function (session, results) {
        // Always say goodbye
        session.send("Ok... See you later!");
    }
]);

bot.dialog('/menu', [
    function (session) {
        builder.Prompts.choice(session, "What kind of service would you like to use?", "greeting|alarm|life|company|picture|weather|help|(quit)");
    },
    function (session, results) {
        if (results.response && results.response.entity != '(quit)') {
            // Launch demo dialog
            session.beginDialog('/' + results.response.entity);
        } else {
            // Exit the menu
            session.endDialog();
        }
    }
    //,
    // function (session, results) {
    //     // The menu runs a loop until the user chooses to (quit).
    //     session.replaceDialog('/menu');
    // }
]).reloadAction('reloadMenu', null, { matches: /^menu|show menu/i });

bot.dialog('/help', [
    function (session) {
         // Send a greeting and show help.
        var card = new builder.HeroCard(session)
            .title("MSR Slack Bot")
            .text("Your loyal assistant - powered by Microsoft Bot Framework and LUIS.")
            .images([
                 builder.CardImage.create(session, "https://raw.githubusercontent.com/kgao/ok-bot/b32f3077dac8a44b0445a39dd61102388df9aa49/img/bot.png")
            ]);
        var msg = new builder.Message(session).attachments([card]);
        session.send(msg);
        session.send("Hi! I'm msrbot, living @ MSR NYC Slack. I can show you what you can use our Bot Builder SDK to do on Slack. And I'm open sourced! Github: https://github.com/kgao/ok-bot");
        // help msg
        session.endDialog("Global commands that are available anytime:\n\n* menu - Exits a demo and returns to the menu.\n* goodbye - End this conversation.\n* help - Displays these commands.");
    }
]);

bot.dialog('/greeting', [
    function (session) { 
        builder.Prompts.text(session, "Hello... What's your name?");
    },
    function (session, results) {
        session.userData.name = results.response;
        builder.Prompts.number(session, "Hi " + results.response + ", How many years have you been coding?"); 
    },
    function (session, results) {
        session.userData.coding = results.response;
        builder.Prompts.choice(session, "What language do you code Node using?", ["JavaScript", "CoffeeScript", "TypeScript", "Python", "C#", "c++", "Java", "R"]);
    },
    function (session, results) {
        session.userData.language = results.response.entity;
        session.send("Got it... " + session.userData.name + 
                     " you've been programming for " + session.userData.coding + 
                     " years and use " + session.userData.language + ".");
    }
]);

bot.dialog('/alarm', dialogNLP_alarm);

bot.dialog('/company', dialogNLP_company);

bot.dialog('/life', [
    function (session) {
        // call custom prompt
        session.beginDialog('/meaningOfLife', { 
            prompt: "What's the meaning of life?", 
            retryPrompt: "Sorry that's incorrect. Guess again." 
        });
    },
    function (session, results) {
        // Check their answer
        if (results.response) {
            session.send("That's correct! The meaning of life is 42.");
        } else {
            session.send("Sorry you couldn't figure it out. Everyone knows that the meaning of life is 42.");
        }
    }
]);
bot.dialog('/meaningOfLife', builder.DialogAction.validatedPrompt(builder.PromptType.text, function (response) {
    return response === '42';
}));


bot.dialog('/picture', [
    function (session) {
        session.send("You can easily send pictures to a user...");
        var msg = new builder.Message(session)
            .attachments([{
                contentType: "image/jpeg",
                contentUrl: "http://www.theoldrobots.com/images62/Bender-18.JPG"
            }]);
        session.endDialog(msg);
    }
]);

//TODO: Create a dialog and bind it to a global action
bot.dialog('/weather', [
    function (session) {
        session.send("Please look outside the window!");
    },
    function (session, args) {
        session.endDialog("The weather in %s is 71 degrees and raining.", args.data);
    }
]);

bot.beginDialogAction('weather', '/weather');   // <-- no 'matches' option means this can only be triggered by a button.


// bot.dialog('/signin', [ 
//     function (session) { 
//         // Send a signin 
//         var msg = new builder.Message(session) 
//             .attachments([ 
//                 new builder.SigninCard(session) 
//                     .text("You must first signin to your account.") 
//                     .button("signin", "http://example.com/") 
//             ]); 
//         session.endDialog(msg); 
//     } 
// ]); 


